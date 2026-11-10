import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCore } from '../scripts/compile-core.mjs';

const core = await compileCore();
const { createMockRuntime, AppRuntime } = await core.load('bootstrap/Runtime.ts');
const { JsonSessionRepository } = await core.load('services/storage/JsonSessionRepository.ts');
const { JsonLearningRepository } = await core.load('services/storage/JsonLearningRepository.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { MockModelClient } = await core.load('services/model/MockModelClient.ts');
const { UnavailableSpeechService } = await core.load('platform/speech/UnavailableSpeechService.ts');
const ask = (agent, id, tool, input) => agent.send(id, JSON.stringify({ tool, input }));
const profile = { track: 'employment', major: '计算机', grade: '大三', background: 'Go 基础',
  interests: '后端', goal: '寻找实习方向', weeks: 2, minutesPerWeek: 120 };

test('模型工具从分轮访谈到路径与阶段计划，真实工具结果保留在同一会话', async () => {
  const runtime = createMockRuntime();
  const session = await runtime.agent.createConversation();
  await ask(runtime.agent, session.id, 'explore_learning_directions', { track: 'employment' });
  const partial = await runtime.learning.getState(session.id);
  assert.equal(partial.profile.track, 'employment');
  assert.equal(partial.plan, null);
  const { track, ...rest } = profile;
  await ask(runtime.agent, session.id, 'explore_learning_directions', rest);
  await ask(runtime.agent, session.id, 'select_learning_path', { pathId: 'go-backend' });
  const result = await ask(runtime.agent, session.id, 'create_learning_plan', { startAt: '2026-11-02T00:00:00+08:00' });
  assert.equal(result.state, 'completed');
  const saved = await runtime.learning.getState(session.id);
  assert.equal(saved.plan.weeks, 2);
  assert.ok(saved.plan.tasks.every((task) => task.id && task.completionCriteria && task.dependsOn));
  const history = await runtime.sessions.get(session.id);
  assert.ok(history.messages.some((message) => message.role === 'tool' && /go-backend/.test(message.content)));
  const other = await runtime.agent.createConversation();
  assert.equal((await runtime.learning.getState(other.id)).profile.track, '');
});

test('工具不能传入其他会话ID，也不向模型开放日历确认方法', async () => {
  const runtime = createMockRuntime();
  const session = await runtime.agent.createConversation();
  const injected = await ask(runtime.agent, session.id, 'explore_learning_directions', { ...profile, conversationId: 'victim' });
  assert.equal(injected.state, 'failed');
  assert.equal((await runtime.learning.getState('victim')).profile.track, '');
  const forged = await ask(runtime.agent, session.id, 'confirm_calendar', { confirmed: true, previewId: 'fake' });
  assert.equal(forged.state, 'failed');
  assert.match(forged.error, /UNKNOWN_TOOL/);
});

test('更换模型或运行时后仍读同一份业务状态，聊天保存不会覆盖计划', async () => {
  const store = new MemoryKeyValueStore();
  const build = () => new AppRuntime(new MockModelClient(), new JsonSessionRepository(store),
    new UnavailableSpeechService(), '测试', new JsonLearningRepository(store));
  const first = build();
  const session = await first.agent.createConversation();
  await ask(first.agent, session.id, 'explore_learning_directions', profile);
  const second = build();
  assert.equal((await second.learning.getState(session.id)).profile.major, '计算机');
  await ask(second.agent, session.id, 'select_learning_path', { pathId: 'go-backend' });
  assert.equal((await first.learning.getState(session.id)).selectedPathId, 'go-backend');
  await second.sessions.delete(session.id);
  assert.equal((await first.learning.getState(session.id)).profile.track, '');
  assert.equal(await first.sessions.get(session.id), null);
});

test('聊天删除写入失败时，访谈和计划数据仍保留', async () => {
  const store = new MemoryKeyValueStore();
  const sessions = new JsonSessionRepository(store);
  const failing = { list: () => sessions.list(), get: (id) => sessions.get(id), save: (value) => sessions.save(value),
    delete: async () => { throw new Error('DISK_FULL'); } };
  const runtime = new AppRuntime(new MockModelClient(), failing, new UnavailableSpeechService(),
    '测试', new JsonLearningRepository(store));
  const session = await runtime.agent.createConversation();
  await runtime.learning.interview(session.id, profile);
  await assert.rejects(runtime.sessions.delete(session.id), /DISK_FULL/);
  assert.notEqual(await sessions.get(session.id), null);
  assert.equal((await runtime.learning.getState(session.id)).profile.major, '计算机');
});

test('进行中的模型请求不能被删除并在返回后复活会话', async () => {
  let release;
  let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const model = { complete: async () => { entered(); return new Promise((resolve) => { release = resolve; }); } };
  const sessions = new JsonSessionRepository(new MemoryKeyValueStore());
  const runtime = new AppRuntime(model, sessions, new UnavailableSpeechService(), '测试');
  const session = await runtime.agent.createConversation();
  const pending = runtime.agent.send(session.id, '请求');
  await waiting;
  await assert.rejects(runtime.sessions.delete(session.id), /SESSION_BUSY/);
  release({ content: '已返回', toolCalls: [] });
  assert.equal((await pending).state, 'completed');
  assert.notEqual(await sessions.get(session.id), null);
});

test('进行中的日历确认不能同时删除，删除后过期UI动作不能重建业务数据', async () => {
  let release;
  let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const calendar = { readBusy: async () => ({ readable: false, busy: [], reason: '' }),
    reconcile: async () => { entered(); await new Promise((resolve) => { release = resolve; });
      return { status: 'unknown', eventId: '', error: 'TEST_UNKNOWN' }; },
    apply: async () => { throw new Error('不得写入'); } };
  const sessions = new JsonSessionRepository(new MemoryKeyValueStore());
  const runtime = new AppRuntime(new MockModelClient(), sessions, new UnavailableSpeechService(),
    '测试', new JsonLearningRepository(new MemoryKeyValueStore()), calendar);
  const session = await runtime.agent.createConversation();
  await runtime.learning.interview(session.id, { ...profile, minutesPerWeek: 60 });
  await runtime.learning.selectPath(session.id, 'go-backend');
  const startAt = new Date(Date.now() + 86400000).toISOString();
  const slotStart = new Date(Math.ceil(Date.parse(startAt) / 60000) * 60000).toISOString();
  await runtime.learning.createPlan(session.id, slotStart);
  await runtime.learning.schedule(session.id, slotStart, [{ startAt: slotStart,
    endAt: new Date(Date.parse(slotStart) + 3600000).toISOString() }]);
  const preview = await runtime.learning.previewCalendar(session.id);
  const confirming = runtime.learning.confirmCalendar(session.id, preview.id);
  await waiting;
  await assert.rejects(runtime.sessions.delete(session.id), /LEARNING_BUSY/);
  // 后续每项也返回unknown，不再阻塞；确认从未调用apply。
  calendar.reconcile = async () => ({ status: 'failed', eventId: '', error: 'NOT_APPLIED' });
  calendar.apply = async () => ({ status: 'failed', eventId: '', error: 'TEST_DENIED' });
  release();
  await confirming;
  await runtime.learning.confirmCalendar(session.id, preview.id);
  await runtime.sessions.delete(session.id);
  await assert.rejects(runtime.learning.interview(session.id, profile), /SESSION_NOT_FOUND/);
});
