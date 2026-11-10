import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCore } from '../scripts/compile-core.mjs';

const core = await compileCore();
const { LearningPlanner } = await core.load('agent/learning/LearningPlanner.ts');
const { JsonLearningRepository } = await core.load('services/storage/JsonLearningRepository.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { UnavailableCalendarPort } = await core.load('platform/calendar/UnavailableCalendarPort.ts');

const start = '2026-11-02T00:00:00+08:00';
const slots = [{ startAt: '2026-11-02T19:00:00+08:00', endAt: '2026-11-02T23:00:00+08:00' },
  { startAt: '2026-11-03T19:00:00+08:00', endAt: '2026-11-03T23:00:00+08:00' }];
const profile = { track: 'employment', major: '计算机科学', grade: '大三', background: '学过 Go 基础',
  interests: '后端', goal: '准备后端实习', weeks: 2, minutesPerWeek: 120 };

// 仅测试端口替身；不计入设备日历验收。receipt 模拟平台按 operationKey 核对已执行操作。
class TestCalendar {
  calls = [];
  receipts = new Map();
  failOnce = false;
  afterWrite;
  async readBusy() { return { readable: false, busy: [], reason: '用户未授权读取，使用手工时段' }; }
  async reconcile(operation) {
    return this.receipts.get(operation.operationKey) ?? { status: 'failed', eventId: '', error: 'NOT_APPLIED' };
  }
  async apply(operation) {
    this.calls.push(structuredClone(operation));
    if (this.failOnce && this.calls.length === 2) {
      this.failOnce = false;
      return { status: 'failed', eventId: '', error: 'PERMISSION_DENIED' };
    }
    const result = { status: 'succeeded', eventId: operation.eventId || `event-${this.calls.length}`, error: '' };
    this.receipts.set(operation.operationKey, result);
    this.afterWrite?.();
    return result;
  }
}

async function setup(calendar = new TestCalendar(), store = new MemoryKeyValueStore(), now = () => Date.parse(start)) {
  const repository = new JsonLearningRepository(store);
  const planner = new LearningPlanner(repository, calendar, now);
  const interview = await planner.interview('session-a', profile);
  assert.equal(interview.missing.length, 0);
  await planner.selectPath('session-a', 'go-backend');
  await planner.createPlan('session-a', start);
  await planner.schedule('session-a', start, slots, 0);
  return { planner, repository, calendar, store };
}

test('先访谈再选择路径，条件缺失不生成正式计划，两个会话不串条件', async () => {
  const planner = new LearningPlanner(new JsonLearningRepository(new MemoryKeyValueStore()), new TestCalendar());
  const first = await planner.interview('a', { track: 'employment' });
  assert.ok(first.missing.includes('major'));
  assert.deepEqual(first.state.candidates, []);
  await assert.rejects(planner.createPlan('a', start), /PATH_NOT_SELECTED/);
  await planner.interview('a', profile);
  const second = await planner.getState('b');
  assert.equal(second.profile.track, '');
  assert.equal(second.plan, null);
  await assert.rejects(planner.interview('a', { track: 'other' }), /INVALID_PROFILE/);
});

test('日程预览只有具体操作，未确认或取消均不调用日历写入', async () => {
  const { planner, calendar } = await setup();
  const preview = await planner.previewCalendar('session-a');
  assert.ok(preview.operations.length >= 2);
  assert.ok(preview.operations.every((operation) => operation.kind === 'create'));
  assert.equal(preview.timeZone, 'UTC（时间戳含明确时区，可按设备时区显示）');
  assert.equal(calendar.calls.length, 0);
  await planner.cancelCalendar('session-a', preview.id);
  await assert.rejects(planner.confirmCalendar('session-a', preview.id), /STALE_PREVIEW/);
  assert.equal(calendar.calls.length, 0);
});

test('预览跨会话、修改后或被调用方篡改都不能变成未授权日历操作', async () => {
  const { planner, calendar } = await setup();
  const preview = await planner.previewCalendar('session-a');
  await assert.rejects(planner.confirmCalendar('other', preview.id), /STALE_PREVIEW/);
  await planner.schedule('session-a', start, slots, 10);
  await assert.rejects(planner.confirmCalendar('session-a', preview.id), /STALE_PREVIEW/);
  assert.equal(calendar.calls.length, 0);
  const latest = await planner.previewCalendar('session-a');
  latest.operations[0].title = '篡改标题';
  await planner.confirmCalendar('session-a', latest.id);
  assert.notEqual(calendar.calls[0].title, '篡改标题');
});

test('批量确认逐项记录成功与失败，重建服务重试仅补未完成项且不重复创建', async () => {
  const calendar = new TestCalendar();
  calendar.failOnce = true;
  const { planner, repository } = await setup(calendar);
  const preview = await planner.previewCalendar('session-a');
  const partial = await planner.confirmCalendar('session-a', preview.id);
  assert.ok(partial.results.some((result) => result.status === 'succeeded'));
  assert.ok(partial.results.some((result) => result.status === 'failed'));
  const successfulKeys = partial.results.filter((result) => result.status === 'succeeded')
    .map((result) => result.operationKey);
  const restarted = new LearningPlanner(repository, calendar, () => Date.parse(start));
  const retried = await restarted.confirmCalendar('session-a', preview.id);
  assert.ok(retried.results.every((result) => result.status === 'succeeded'));
  for (const key of successfulKeys) assert.equal(calendar.calls.filter((call) => call.operationKey === key).length, 1);
  const before = calendar.calls.length;
  await restarted.confirmCalendar('session-a', preview.id);
  assert.equal(calendar.calls.length, before);
  assert.equal((await restarted.getState('session-a')).calendarLinks.length, preview.operations.length);
});

test('平台写成功而本地保存失败，恢复后先核对平台结果再继续，不重复创建', async () => {
  const backing = new MemoryKeyValueStore();
  let fail = false;
  const store = { get: (key) => backing.get(key), set: async (key, value) => {
    if (fail) { fail = false; throw new Error('DISK_FULL'); }
    await backing.set(key, value);
  } };
  const calendar = new TestCalendar();
  const { planner, repository } = await setup(calendar, store);
  const preview = await planner.previewCalendar('session-a');
  calendar.afterWrite = () => { calendar.afterWrite = undefined; fail = true; };
  await assert.rejects(planner.confirmCalendar('session-a', preview.id), /DISK_FULL/);
  const restarted = new LearningPlanner(repository, calendar, () => Date.parse(start));
  const restored = await restarted.confirmCalendar('session-a', preview.id);
  assert.ok(restored.results.every((result) => result.status === 'succeeded'));
  assert.equal(calendar.calls.filter((call) => call.operationKey === preview.operations[0].operationKey).length, 1);
});

test('日历操作结果未知且无法核对时，不盲目写入，保留计划及逐项待核对状态', async () => {
  const calendar = new TestCalendar();
  calendar.reconcile = async () => ({ status: 'unknown', eventId: '', error: 'TIMEOUT' });
  const { planner } = await setup(calendar);
  const preview = await planner.previewCalendar('session-a');
  const result = await planner.confirmCalendar('session-a', preview.id);
  assert.ok(result.results.every((item) => item.status === 'unknown'));
  assert.equal(calendar.calls.length, 0);
  assert.notEqual((await planner.getState('session-a')).plan, null);
});

test('完成反馈保留任务ID，重排不移动已完成任务，关联日程用原ID更新', async () => {
  const { planner, calendar } = await setup();
  const preview = await planner.previewCalendar('session-a');
  await planner.confirmCalendar('session-a', preview.id);
  const before = await planner.getState('session-a');
  const task = before.plan.tasks.find((item) => item.week === 1);
  await planner.recordProgress('session-a', task.id, 'done');
  await planner.schedule('session-a', start, [{ startAt: '2026-11-04T19:00:00+08:00', endAt: '2026-11-04T23:00:00+08:00' }], 0);
  const after = await planner.getState('session-a');
  assert.equal(after.plan.tasks.find((item) => item.id === task.id).status, 'done');
  const adjusted = await planner.previewCalendar('session-a');
  assert.equal(adjusted.operations.some((operation) => operation.taskId === task.id), false);
  assert.ok(adjusted.operations.some((operation) => operation.kind === 'update' && operation.eventId.startsWith('event-')));
  await planner.confirmCalendar('session-a', adjusted.id);
  assert.ok(calendar.calls.some((operation) => operation.kind === 'update'));
});

test('未提供设备日历时明确不可用，但仍可形成与保存应用内计划', async () => {
  const { planner } = await setup(new UnavailableCalendarPort());
  const preview = await planner.previewCalendar('session-a');
  const result = await planner.confirmCalendar('session-a', preview.id);
  assert.ok(result.results.every((item) => item.status === 'failed' && /CALENDAR_UNAVAILABLE/.test(item.error)));
  const saved = await planner.getState('session-a');
  assert.ok(saved.plan.schedule.length > 0);
  assert.deepEqual(saved.calendarLinks, []);
});

test('用户可修改任务截止时间与依赖，循环修改不落盘，过期确认失效', async () => {
  const { planner } = await setup();
  const state = await planner.getState('session-a');
  const first = state.plan.tasks[0];
  const second = state.plan.tasks[1];
  const preview = await planner.previewCalendar('session-a');
  await planner.updateTaskConstraints('session-a', second.id,
    { dueAt: '2026-11-02T19:30:00+08:00', dependsOn: [first.id] });
  await assert.rejects(planner.confirmCalendar('session-a', preview.id), /STALE_PREVIEW/);
  await planner.createPlan('session-a', start);
  const regenerated = await planner.getState('session-a');
  assert.equal(regenerated.plan.tasks[1].dueAt, '2026-11-02T19:30:00+08:00');
  assert.deepEqual(regenerated.plan.tasks[1].dependsOn, [first.id]);
  const result = await planner.schedule('session-a', start, slots);
  assert.ok(result.result.unscheduledTaskIds.includes(second.id));
  await assert.rejects(planner.updateTaskConstraints('session-a', first.id, { dependsOn: [second.id] }), /INVALID_DEPENDENCY/);
  assert.deepEqual((await planner.getState('session-a')).plan.tasks[0].dependsOn, []);
  await planner.updateTaskConstraints('session-a', second.id, { dependsOn: [] });
  await planner.createPlan('session-a', start);
  assert.deepEqual((await planner.getState('session-a')).plan.tasks[1].dependsOn, []);
});

test('新时段全部冲突时仍可预览确认删除已不适用的旧未来日程', async () => {
  const { planner, calendar } = await setup();
  const initial = await planner.previewCalendar('session-a');
  await planner.confirmCalendar('session-a', initial.id);
  calendar.readBusy = async () => ({ readable: true, busy: slots, reason: '' });
  const result = await planner.schedule('session-a', start, slots);
  assert.equal(result.state.plan.schedule.length, 0);
  const cleanup = await planner.previewCalendar('session-a');
  assert.ok(cleanup.operations.length > 0);
  assert.ok(cleanup.operations.every((operation) => operation.kind === 'delete'));
  const confirmed = await planner.confirmCalendar('session-a', cleanup.id);
  assert.ok(confirmed.results.every((item) => item.status === 'succeeded'));
});

test('取消未知操作仅核对结果，不补写，取消意图持久化后不能再次确认写入', async () => {
  const calendar = new TestCalendar();
  calendar.reconcile = async () => ({ status: 'unknown', eventId: '', error: 'TIMEOUT' });
  const { planner } = await setup(calendar);
  const preview = await planner.previewCalendar('session-a');
  await planner.confirmCalendar('session-a', preview.id);
  await assert.rejects(planner.cancelCalendar('session-a', preview.id), /CALENDAR_UNRESOLVED/);
  assert.equal((await planner.getState('session-a')).preview.cancelRequested, true);
  calendar.reconcile = async () => ({ status: 'failed', eventId: '', error: 'NOT_APPLIED' });
  await assert.rejects(planner.confirmCalendar('session-a', preview.id), /CALENDAR_CANCELLED/);
  await planner.cancelCalendar('session-a', preview.id);
  assert.equal(calendar.calls.length, 0);
  assert.equal((await planner.getState('session-a')).preview, null);
});

test('取消时核对已执行的未知项并保存关联，但不重复执行或自动删除', async () => {
  const calendar = new TestCalendar();
  calendar.apply = async (op) => {
    calendar.calls.push(op);
    calendar.receipts.set(op.operationKey, { status: 'succeeded', eventId: `event-${calendar.calls.length}`, error: '' });
    return { status: 'unknown', eventId: '', error: 'TIMEOUT_AFTER_WRITE' };
  };
  const { planner } = await setup(calendar);
  const preview = await planner.previewCalendar('session-a');
  await planner.confirmCalendar('session-a', preview.id);
  const before = calendar.calls.length;
  await planner.cancelCalendar('session-a', preview.id);
  const state = await planner.getState('session-a');
  assert.equal(state.calendarLinks.length, preview.operations.length);
  assert.equal(calendar.calls.length, before);
  assert.equal(state.preview, null);
});

test('平台回执格式错误按结果未知处理，不能当作成功或继续盲写', async () => {
  const calendar = new TestCalendar();
  calendar.reconcile = async () => ({ status: 'succeeded', error: '' });
  const { planner } = await setup(calendar);
  const preview = await planner.previewCalendar('session-a');
  const result = await planner.confirmCalendar('session-a', preview.id);
  assert.ok(result.results.every((item) => item.status === 'unknown'));
  assert.equal(calendar.calls.length, 0);
});

test('业务状态损坏或版本不兼容时拒绝覆盖，恢复存储不会污染聊天历史', async () => {
  const store = new MemoryKeyValueStore();
  await store.set('learning_v1', '{broken');
  const repository = new JsonLearningRepository(store);
  await assert.rejects(repository.load('a'), /LEARNING_STORAGE_CORRUPT/);
  const planner = new LearningPlanner(repository, new TestCalendar());
  await assert.rejects(planner.interview('a', profile), /LEARNING_STORAGE_CORRUPT/);
  assert.equal(await store.get('learning_v1'), '{broken');
  await store.set('learning_v1', '{"version":99,"states":[]}');
  await assert.rejects(repository.load('a'), /LEARNING_STORAGE_CORRUPT/);
});

test('过去的关联日程保留，重新排期创建新的未来日程，后续调整复用未来关联', async () => {
  let now = Date.parse(start);
  const { planner, calendar } = await setup(new TestCalendar(), new MemoryKeyValueStore(), () => now);
  const first = await planner.previewCalendar('session-a');
  await planner.confirmCalendar('session-a', first.id);
  const past = (await planner.getState('session-a')).calendarLinks;
  now = Date.parse('2026-11-04T00:00:00+08:00');
  await planner.schedule('session-a', new Date(now).toISOString(), [
    { startAt: '2026-11-04T19:00:00+08:00', endAt: '2026-11-04T23:00:00+08:00' }
  ]);
  const moved = await planner.previewCalendar('session-a');
  assert.ok(moved.operations.length > 0);
  assert.ok(moved.operations.every((operation) => operation.kind === 'create'));
  assert.ok(moved.operations.every((operation) => !past.some((link) => link.appEventKey === operation.appEventKey)));
  await planner.confirmCalendar('session-a', moved.id);
  const futureKeys = moved.operations.map((operation) => operation.appEventKey);
  await planner.schedule('session-a', new Date(now).toISOString(), [
    { startAt: '2026-11-05T19:00:00+08:00', endAt: '2026-11-05T23:00:00+08:00' }
  ]);
  const again = await planner.previewCalendar('session-a');
  assert.ok(again.operations.every((operation) => operation.kind === 'update' && futureKeys.includes(operation.appEventKey)));
  await planner.confirmCalendar('session-a', again.id);
  assert.deepEqual((await planner.getState('session-a')).calendarLinks.filter((link) =>
    past.some((old) => old.eventId === link.eventId)), past);
  assert.equal(calendar.calls.some((operation) => operation.kind !== 'create' &&
    past.some((link) => link.eventId === operation.eventId)), false);
});

test('排期仅忽略可替换的本应用关联，重叠的外部事件和无标签busy仍保留', async () => {
  const { planner, calendar } = await setup();
  const preview = await planner.previewCalendar('session-a');
  await planner.confirmCalendar('session-a', preview.id);
  const links = (await planner.getState('session-a')).calendarLinks;
  calendar.readBusy = async () => ({ readable: true, reason: '', busy: [
    ...links.map((link) => ({ startAt: link.startAt, endAt: link.endAt,
      eventId: link.eventId, appEventKey: link.appEventKey })),
    { startAt: '2026-11-02T19:00:00+08:00', endAt: '2026-11-02T20:00:00+08:00', eventId: 'user-event' },
    { startAt: '2026-11-02T21:00:00+08:00', endAt: '2026-11-02T21:30:00+08:00' }
  ] });
  const scheduled = await planner.schedule('session-a', start, slots);
  assert.deepEqual(scheduled.result.blocks.map((block) => [block.startAt, block.endAt]), [
    ['2026-11-02T12:00:00.000Z', '2026-11-02T13:00:00.000Z'],
    ['2026-11-02T13:30:00.000Z', '2026-11-02T14:30:00.000Z']
  ]);
});

test('确认前批量拒绝已经过时的首次预览和确定失败重试，整批没有新写入', async () => {
  for (const failedRetry of [false, true]) {
    let now = Date.parse(start);
    const calendar = new TestCalendar();
    calendar.failOnce = failedRetry;
    const { planner } = await setup(calendar, new MemoryKeyValueStore(), () => now);
    const preview = await planner.previewCalendar('session-a');
    if (failedRetry) await planner.confirmCalendar('session-a', preview.id);
    const before = calendar.calls.length;
    now = Date.parse('2026-11-04T00:00:00+08:00');
    await assert.rejects(planner.confirmCalendar('session-a', preview.id), /STALE_PREVIEW/);
    assert.equal(calendar.calls.length, before);
  }
});

test('更新预览目标后来成为过去日程时，不能通过未来的新时间移动过去日程', async () => {
  let now = Date.parse(start);
  const { planner, calendar } = await setup(new TestCalendar(), new MemoryKeyValueStore(), () => now);
  const first = await planner.previewCalendar('session-a');
  await planner.confirmCalendar('session-a', first.id);
  await planner.schedule('session-a', start, [
    { startAt: '2026-11-04T19:00:00+08:00', endAt: '2026-11-04T23:00:00+08:00' }
  ]);
  const update = await planner.previewCalendar('session-a');
  assert.ok(update.operations.every((operation) => operation.kind === 'update'));
  const before = calendar.calls.length;
  now = Date.parse('2026-11-03T00:00:00+08:00');
  await assert.rejects(planner.confirmCalendar('session-a', update.id), /STALE_PREVIEW/);
  assert.equal(calendar.calls.length, before);
});

test('未知结果跨日后仍能核对已执行结果，但确定未执行的过时操作不得apply', async () => {
  let now = Date.parse(start);
  const calendar = new TestCalendar();
  calendar.reconcile = async () => ({ status: 'unknown', eventId: '', error: 'TIMEOUT' });
  const { planner } = await setup(calendar, new MemoryKeyValueStore(), () => now);
  const preview = await planner.previewCalendar('session-a');
  await planner.confirmCalendar('session-a', preview.id);
  now = Date.parse('2026-11-04T00:00:00+08:00');
  const recoveredKey = preview.operations[0].operationKey;
  calendar.reconcile = async (operation) => operation.operationKey === recoveredKey
    ? { status: 'succeeded', eventId: 'recovered-event', error: '' }
    : { status: 'failed', eventId: '', error: 'NOT_APPLIED' };
  const recovered = await planner.confirmCalendar('session-a', preview.id);
  assert.equal(recovered.results[0].status, 'succeeded');
  assert.equal(recovered.results[0].eventId, 'recovered-event');
  assert.ok(recovered.results.slice(1).every((item) => item.status === 'failed' && /STALE/.test(item.error)));
  assert.equal(calendar.calls.length, 0);
  await planner.recordProgress('session-a', preview.operations[0].taskId, 'done');
});

test('同路径重建保留pending的实际剩余耗时、原估时和完成状态', async () => {
  const { planner } = await setup();
  const before = await planner.getState('session-a');
  const [first, second] = before.plan.tasks;
  await planner.recordProgress('session-a', first.id, 'pending', 15);
  await planner.recordProgress('session-a', second.id, 'done');
  await planner.interview('session-a', { minutesPerWeek: 240 });
  const rebuilt = await planner.createPlan('session-a', start);
  assert.equal(rebuilt.plan.tasks.find((task) => task.id === first.id).remainingMinutes, 15);
  assert.equal(rebuilt.plan.tasks.find((task) => task.id === first.id).estimatedMinutes, 60);
  assert.equal(rebuilt.plan.tasks.find((task) => task.id === first.id).status, 'pending');
  assert.equal(rebuilt.plan.tasks.find((task) => task.id === second.id).status, 'done');
});

test('切换路径后不会删除已完成任务的未来日历关联', async () => {
  const { planner } = await setup();
  const preview = await planner.previewCalendar('session-a');
  await planner.confirmCalendar('session-a', preview.id);
  const doneId = preview.operations[0].taskId;
  await planner.recordProgress('session-a', doneId, 'done');
  await planner.selectPath('session-a', 'frontend');
  await planner.createPlan('session-a', start);
  await planner.schedule('session-a', start, slots);
  const next = await planner.previewCalendar('session-a');
  assert.equal(next.operations.some((operation) => operation.taskId === doneId), false);
  assert.ok(next.operations.some((operation) => operation.kind === 'delete'));
  await planner.confirmCalendar('session-a', next.id);
  assert.ok((await planner.getState('session-a')).calendarLinks.some((link) => link.taskId === doneId));
});

test('磁盘预览必须是有效时间并绑定当前计划内容和命名空间', async (t) => {
  const { planner, store, repository, calendar } = await setup();
  await planner.previewCalendar('session-a');
  const raw = await store.get('learning_v1');
  const cases = [
    ['非法月份', (state) => { state.preview.operations[0].startAt = '2026-99-02T19:00:00+08:00'; }],
    ['不存在的日期', (state) => { state.plan.schedule[0].startAt = '2026-02-30T19:00:00+08:00';
      state.preview.operations[0].startAt = state.plan.schedule[0].startAt; }],
    ['预览旧revision', (state) => { state.preview.revision--; }],
    ['预览旧planVersion', (state) => { state.preview.planVersion--; }],
    ['预览标题与任务不一致', (state) => { state.preview.operations[0].title = '额外日程'; }],
    ['预览任务身份不一致', (state) => { state.preview.operations[0].taskId = 'other-task'; }],
    ['预览时间与排期不一致', (state) => { state.preview.operations[0].endAt = '2026-11-02T23:59:00+08:00'; }],
    ['预览提醒与排期不一致', (state) => { state.preview.operations[0].reminderMinutes = 60; }],
    ['其他会话的appEventKey', (state) => { state.preview.operations[0].appEventKey = 'other:plan:block'; }],
    ['其他操作的operationKey', (state) => { state.preview.operations[0].operationKey = 'other-operation';
      state.preview.results[0].operationKey = 'other-operation'; }],
    ['新建携带外部eventId', (state) => { state.preview.operations[0].eventId = 'external-id'; }]
  ];
  for (const [name, mutate] of cases) await t.test(name, async () => {
    const document = JSON.parse(raw);
    mutate(document.states[0]);
    const corrupt = JSON.stringify(document);
    await store.set('learning_v1', corrupt);
    await assert.rejects(repository.load('session-a'), /LEARNING_STORAGE_CORRUPT/);
    await assert.rejects(planner.confirmCalendar('session-a', document.states[0].preview.id), /LEARNING_STORAGE_CORRUPT/);
    assert.equal(calendar.calls.length, 0);
    assert.equal(await store.get('learning_v1'), corrupt);
  });
  await store.set('learning_v1', raw);
});

test('磁盘更新和删除必须与本应用关联一致，成功删除结果可以在重启后读取', async (t) => {
  const { planner, store, repository } = await setup();
  const first = await planner.previewCalendar('session-a');
  await planner.confirmCalendar('session-a', first.id);
  await planner.schedule('session-a', start, [
    { startAt: '2026-11-04T19:00:00+08:00', endAt: '2026-11-04T23:00:00+08:00' }
  ]);
  await planner.previewCalendar('session-a');
  const updateRaw = await store.get('learning_v1');
  await t.test('更新eventId必须有相同已保存关联', async () => {
    const document = JSON.parse(updateRaw);
    document.states[0].preview.operations[0].eventId = 'external-event';
    await store.set('learning_v1', JSON.stringify(document));
    await assert.rejects(repository.load('session-a'), /LEARNING_STORAGE_CORRUPT/);
  });
  await store.set('learning_v1', updateRaw);
  await planner.selectPath('session-a', 'frontend');
  await planner.createPlan('session-a', start);
  await planner.schedule('session-a', start, slots);
  const deletion = await planner.previewCalendar('session-a');
  assert.ok(deletion.operations.some((operation) => operation.kind === 'delete'));
  const deleteRaw = await store.get('learning_v1');
  await t.test('删除内容必须匹配旧关联', async () => {
    const document = JSON.parse(deleteRaw);
    document.states[0].preview.operations.find((operation) => operation.kind === 'delete').title = '无关日程';
    await store.set('learning_v1', JSON.stringify(document));
    await assert.rejects(repository.load('session-a'), /LEARNING_STORAGE_CORRUPT/);
  });
  await store.set('learning_v1', deleteRaw);
  await planner.confirmCalendar('session-a', deletion.id);
  const restored = await new JsonLearningRepository(store).load('session-a');
  assert.ok(restored.preview.results.every((item) => item.status === 'succeeded'));
  assert.equal(restored.calendarLinks.some((link) => first.operations.some((operation) =>
    operation.appEventKey === link.appEventKey)), false);
});

test('持锁后核对会话是否仍存在，已删除会话不能被过期规划动作复活', async () => {
  const { repository, calendar, store } = await setup();
  const before = await store.get('learning_v1');
  const guarded = new LearningPlanner(repository, calendar, () => Date.parse(start), async () => false);
  await assert.rejects(guarded.interview('session-a', { interests: '过期页面修改' }), /SESSION_NOT_FOUND/);
  assert.equal(await store.get('learning_v1'), before);
});

test('删除本地状态在同一规划锁内补偿，任一删除失败均不丢业务数据', async (t) => {
  for (const failure of ['session', 'learning', 'restore', 'none']) await t.test(failure, async () => {
    const backing = new MemoryKeyValueStore();
    let failWrite = false;
    const store = { get: (key) => backing.get(key), set: async (key, value) => {
      if (failWrite) { failWrite = false; throw new Error('DISK_FULL'); }
      await backing.set(key, value);
    } };
    const { planner, repository } = await setup(new TestCalendar(), store);
    const before = await store.get('learning_v1');
    let sessionExists = true;
    let restores = 0;
    failWrite = failure === 'learning' || failure === 'restore';
    const removal = () => planner.deleteLocalState('session-a', async () => {
      if (failure === 'session') throw new Error('SESSION_DELETE_FAILED');
      sessionExists = false;
      await assert.rejects(planner.interview('session-a', { interests: '并发操作' }), /LEARNING_BUSY/);
    }, async () => {
      restores++;
      await assert.rejects(planner.interview('session-a', { interests: '补偿时并发操作' }), /LEARNING_BUSY/);
      if (failure === 'restore') throw new Error('RESTORE_FAILED');
      sessionExists = true;
    });
    if (failure === 'none') {
      await removal();
      assert.equal(sessionExists, false);
      assert.equal(restores, 0);
      assert.equal(await repository.load('session-a'), null);
    } else {
      await assert.rejects(removal(), failure === 'session' ? /SESSION_DELETE_FAILED/
        : failure === 'restore' ? /DELETE_RECOVERY_REQUIRED/ : /DISK_FULL/);
      assert.equal(await store.get('learning_v1'), before);
      assert.equal(restores, failure === 'session' ? 0 : 1);
      assert.equal(sessionExists, failure !== 'restore');
    }
  });
});

test('仍有未知日历结果时不允许删除，也不会先移除会话', async () => {
  const calendar = new TestCalendar();
  calendar.reconcile = async () => ({ status: 'unknown', eventId: '', error: 'TIMEOUT' });
  const { planner } = await setup(calendar);
  const preview = await planner.previewCalendar('session-a');
  await planner.confirmCalendar('session-a', preview.id);
  let removed = false;
  await assert.rejects(planner.deleteLocalState('session-a', async () => { removed = true; }, async () => {}),
    /CALENDAR_UNRESOLVED/);
  assert.equal(removed, false);
});
