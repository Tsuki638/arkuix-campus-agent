import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCore } from '../scripts/compile-core.mjs';

const core = await compileCore();
const { createMockRuntime, createRuntime, AppRuntime } = await core.load('bootstrap/Runtime.ts');
const { JsonSessionRepository } = await core.load('services/storage/JsonSessionRepository.ts');
const { JsonLearningRepository } = await core.load('services/storage/JsonLearningRepository.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { MockModelClient } = await core.load('services/model/MockModelClient.ts');
const { UnavailableSpeechService } = await core.load('platform/speech/UnavailableSpeechService.ts');
const ask = (agent, id, tool, input) => agent.send(id, JSON.stringify({ tool, input }));
const profile = { track: 'employment', major: '计算机', grade: '大三', background: 'Go 基础',
  interests: '后端', goal: '寻找实习方向', weeks: 2, minutesPerWeek: 120 };

test('方向排期复用应用日历服务，确认前零写入，确认后按稳定标识恢复同一事件', async () => {
  const store = new MemoryKeyValueStore();
  const saved = new Map();
  let permission = false;
  let writes = 0;
  const service = { isAvailable: () => true, unavailableReason: () => '',
    requestPermission: async () => permission,
    findEvent: async (entry) => saved.get(entry.id) ?? null,
    createEvent: async (entry) => {
      writes++;
      const reference = { calendarId: 7, eventId: writes };
      saved.set(entry.id, reference);
      return reference;
    } };
  const build = () => createRuntime(new MockModelClient(), store, new UnavailableSpeechService(), '测试', service);
  const runtime = build();
  const session = await runtime.agent.createConversation();
  const from = new Date(Math.ceil(Date.now() / 60000) * 60000 + 86400000).toISOString();
  const endAt = new Date(Date.parse(from) + 3600000).toISOString();
  await ask(runtime.agent, session.id, 'explore_learning_directions', { ...profile, minutesPerWeek: 60 });
  await ask(runtime.agent, session.id, 'select_learning_path', { pathId: 'go-backend' });
  await ask(runtime.agent, session.id, 'create_learning_plan', { startAt: from });
  await ask(runtime.agent, session.id, 'schedule_learning_tasks', { from, available: [{ startAt: from, endAt }] });
  const previewResult = await ask(runtime.agent, session.id, 'preview_learning_calendar', {});
  assert.equal(previewResult.state, 'completed');
  const { preview } = await runtime.learning.getState(session.id);
  assert.equal(writes, 0);
  await assert.rejects(runtime.learning.confirmCalendar(session.id, preview.id), /CALENDAR_PERMISSION/);
  assert.equal(writes, 0);
  permission = true;
  const confirmed = await build().learning.confirmCalendar(session.id, preview.id);
  assert.equal(confirmed.results.length, 2);
  assert.ok(confirmed.results.every((item) => item.status === 'succeeded'));
  assert.equal(writes, 2);
  await build().learning.confirmCalendar(session.id, preview.id);
  assert.equal(writes, 2);
  assert.deepEqual((await build().learning.getState(session.id)).calendarLinks.map((link) => link.eventId), ['7:1', '7:2']);
});

test('模型的具体任务经周预算和依赖校验后才成为应用内计划', async () => {
  const runtime = createMockRuntime();
  const session = await runtime.agent.createConversation();
  await ask(runtime.agent, session.id, 'explore_learning_directions', profile);
  await ask(runtime.agent, session.id, 'select_learning_path', { pathId: 'go-backend' });
  const startAt = '2026-11-16T00:00:00+08:00';
  const tasks = [
    { id: 'handler', title: '用 net/http 写一个查询接口', phase: '接口练习', week: 1, estimatedMinutes: 70,
      completionCriteria: '保存一次 curl 请求和 200 JSON 响应', dependsOn: [] },
    { id: 'test', title: '为查询接口补充边界测试', phase: '接口练习', week: 1, estimatedMinutes: 40,
      completionCriteria: '验证缺少参数时返回 400', dependsOn: ['handler'] },
    { id: 'readme', title: '整理运行与验证步骤', phase: '成果整理', week: 2, estimatedMinutes: 45,
      completionCriteria: '按说明在新终端复现请求', dependsOn: ['test'] }
  ];
  for (const invalid of [
    [{ ...tasks[0], estimatedMinutes: 100 }, ...tasks.slice(1)],
    [{ ...tasks[0], dependsOn: ['test'] }, ...tasks.slice(1)],
    [{ ...tasks[0], dependsOn: ['missing'] }, ...tasks.slice(1)]
  ]) {
    const failed = await ask(runtime.agent, session.id, 'create_learning_plan', { startAt, tasks: invalid });
    assert.equal(failed.state, 'failed');
    assert.match(failed.error, /INVALID_TASK_DRAFT/);
    assert.equal((await runtime.learning.getState(session.id)).plan, null);
  }
  const result = await ask(runtime.agent, session.id, 'create_learning_plan', { startAt, tasks });
  assert.equal(result.state, 'completed');
  const { plan } = await runtime.learning.getState(session.id);
  assert.equal(plan.tasks[0].title, tasks[0].title);
  assert.deepEqual(plan.tasks[1].dependsOn, [plan.tasks[0].id]);
  await runtime.learning.recordProgress(session.id, plan.tasks[0].id, 'done');
  await runtime.learning.createPlan(session.id, startAt);
  assert.deepEqual((await runtime.learning.getState(session.id)).plan.tasks.map((item) => [item.title, item.status]),
    [[tasks[0].title, 'done'], [tasks[1].title, 'pending'], [tasks[2].title, 'pending']]);
});

test('定制计划重排后只更新或删除拥有的日历事件，并保留已完成关联', async () => {
  const store = new MemoryKeyValueStore();
  const saved = new Map();
  const updates = [], deletions = [];
  const past = new Set();
  const service = { isAvailable: () => true, unavailableReason: () => '', requestPermission: async () => true,
    findEvent: async (entry) => saved.get(entry.id)?.ref ?? null,
    createEvent: async (entry) => {
      const ref = { calendarId: 7, eventId: saved.size + 1 };
      saved.set(entry.id, { ref, entry });
      return ref;
    },
    matchesEvent: async (entry, ref) => {
      const existing = saved.get(entry.id);
      if (!existing) return 'missing';
      if (existing.ref.eventId !== ref.eventId || existing.ref.calendarId !== ref.calendarId) return 'unowned';
      if (past.has(entry.id)) return 'past';
      return existing.entry.startTime === entry.startTime && existing.entry.endTime === entry.endTime ? 'matches' : 'different';
    },
    updateEvent: async (entry, ref) => { updates.push(ref); saved.set(entry.id, { ref, entry }); },
    deleteEvent: async (entry, ref) => { deletions.push(ref); saved.delete(entry.id); } };
  const runtime = createRuntime(new MockModelClient(), store, new UnavailableSpeechService(), '测试', service);
  const session = await runtime.agent.createConversation();
  const id = session.id;
  const base = Math.ceil(Date.now() / 60000) * 60000 + 86400000;
  const at = (minutes) => new Date(base + minutes * 60000).toISOString();
  await runtime.learning.interview(id, { ...profile, minutesPerWeek: 120 });
  await runtime.learning.selectPath(id, 'go-backend');
  await runtime.learning.createPlan(id, at(0));
  await runtime.learning.schedule(id, at(0), [{ startAt: at(0), endAt: at(60) }, { startAt: at(90), endAt: at(150) }]);
  const initial = await runtime.learning.previewCalendar(id);
  await runtime.learning.confirmCalendar(id, initial.id);
  await runtime.learning.schedule(id, at(0), [{ startAt: at(180), endAt: at(240) }]);
  const revised = await runtime.learning.previewCalendar(id);
  assert.deepEqual(revised.operations.map((item) => item.kind), ['update', 'delete']);
  assert.deepEqual([updates.length, deletions.length], [0, 0]);
  const key = revised.operations[0].appEventKey;
  const original = saved.get(key);
  saved.set(key, { ...original, ref: { calendarId: 99, eventId: 1 } });
  const partial = await runtime.learning.confirmCalendar(id, revised.id);
  assert.deepEqual(partial.results.map((item) => item.status), ['failed', 'succeeded']);
  assert.deepEqual(updates, []);
  saved.set(key, original);
  past.add(key);
  const outdated = await runtime.learning.confirmCalendar(id, revised.id);
  assert.match(outdated.results[0].error, /已经开始/);
  assert.deepEqual(updates, []);
  past.delete(key);
  const result = await runtime.learning.confirmCalendar(id, revised.id);
  assert.ok(result.results.every((item) => item.status === 'succeeded'));
  assert.deepEqual(updates, [{ calendarId: 7, eventId: 1 }]);
  assert.deepEqual(deletions, [{ calendarId: 7, eventId: 2 }]);
  const state = await runtime.learning.getState(id);
  await runtime.learning.recordProgress(id, state.plan.tasks[0].id, 'done');
  const retained = await runtime.learning.getState(id);
  assert.equal(retained.calendarLinks[0].eventId, '7:1');
  assert.equal(retained.calendarLinks[0].taskCompleted, true);
});

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

test('周排期容量不足仍返回可读的部分结果与待排任务，允许继续预览已排时段', async () => {
  const runtime = createMockRuntime();
  const session = await runtime.agent.createConversation();
  const id = session.id;
  const start = Math.ceil(Date.now() / 60000) * 60000 + 86400000;
  const from = new Date(start).toISOString();
  const endAt = new Date(start + 30 * 60000).toISOString();
  await runtime.learning.interview(id, profile);
  await runtime.learning.selectPath(id, 'go-backend');
  await runtime.learning.createPlan(id, from);
  const response = await ask(runtime.agent, id, 'schedule_learning_tasks', { from, available: [{ startAt: from, endAt }] });
  assert.equal(response.state, 'completed');
  const message = response.conversation.messages.find((item) => item.role === 'tool');
  const { success, content } = JSON.parse(message.content);
  const result = JSON.parse(content);
  assert.equal(success, true);
  assert.equal(result.status, 'partial');
  assert.equal(result.result.blocks.length, 1);
  assert.equal(result.result.unscheduledTaskIds.length, 2);
  assert.match(result.message, /2 项任务/);
  assert.equal((await runtime.learning.previewCalendar(id)).operations.length, 1);
});

test('用户下调周预算后旧预览失效，重排按新预算截断可用时间', async () => {
  const runtime = createMockRuntime();
  const { id } = await runtime.agent.createConversation();
  const start = Math.ceil(Date.now() / 60000) * 60000 + 86400000;
  const from = new Date(start).toISOString();
  const available = [{ startAt: from, endAt: new Date(start + 120 * 60000).toISOString() }];
  await runtime.learning.interview(id, profile);
  await runtime.learning.selectPath(id, 'go-backend');
  await runtime.learning.createPlan(id, from, [
    { id: 'practice', title: '完成一次接口练习', phase: '实践', week: 1, estimatedMinutes: 100,
      completionCriteria: '保存请求和响应', dependsOn: [] },
    { id: 'notes', title: '记录实验结果', phase: '总结', week: 2, estimatedMinutes: 30,
      completionCriteria: '整理启动步骤', dependsOn: ['practice'] }
  ]);
  await runtime.learning.schedule(id, from, available);
  await runtime.learning.previewCalendar(id);
  await runtime.learning.interview(id, { minutesPerWeek: 30 });
  await assert.rejects(runtime.learning.previewCalendar(id), /SCHEDULE_REQUIRED/);
  const { result, status } = await runtime.learning.schedule(id, from, available);
  assert.equal(status, 'partial');
  assert.equal(result.blocks.reduce((minutes, block) => minutes + (Date.parse(block.endAt) - Date.parse(block.startAt)) / 60000, 0), 30);
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
