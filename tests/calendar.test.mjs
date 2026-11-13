import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCore } from '../scripts/compile-core.mjs';

const core = await compileCore();
const { CalendarCoordinator } = await core.load('services/calendar/CalendarCoordinator.ts');
const { calendarTimeText, calendarInputTime, planCalendarInputs } = await core.load('services/calendar/CalendarTime.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { UnavailableCalendarService } = await core.load('platform/calendar/UnavailableCalendarService.ts');
const { UnavailableSpeechService } = await core.load('platform/speech/UnavailableSpeechService.ts');
const { PrepareCalendarEventsTool, ListCalendarDraftsTool } = await core.load('agent/tools/CalendarTools.ts');
const { StudyDataRepository } = await core.load('services/storage/StudyDataRepository.ts');
const { createRuntime } = await core.load('bootstrap/Runtime.ts');

const iso = (time) => calendarInputTime(calendarTimeText(time));
const input = (overrides = {}) => ({ title: '高数复习', startTime: iso(Date.now() + 86400000),
  endTime: iso(Date.now() + 90000000), reminderMinutes: [10], ...overrides });
function fakeCalendar() {
  const events = new Map();
  const calls = { permission: 0, find: 0, create: 0 };
  return { events, calls, isAvailable: () => true, unavailableReason: () => '',
    requestPermission: async () => { calls.permission++; return true; },
    findEvent: async (event) => { calls.find++; return events.get(event.id) || null; },
    createEvent: async (event) => {
      calls.create++;
      const reference = { calendarId: 7, eventId: events.size + 1 };
      events.set(event.id, reference);
      return reference;
    } };
}

test('日历工具只准备草案，伪造 confirmed 参数不触发权限或写入，读取按真实会话隔离', async () => {
  const store = new MemoryKeyValueStore(), service = fakeCalendar();
  const coordinator = new CalendarCoordinator(store, service);
  const tool = new PrepareCalendarEventsTool(coordinator, new StudyDataRepository(store));
  const result = await tool.execute(JSON.stringify({ conversationId: 'forged', confirmed: true,
    timeZone: 'Asia/Shanghai', events: [input()] }), { conversationId: 'real-session' });
  assert.equal(result.success, true);
  assert.equal(JSON.parse(result.content).status, 'pending_confirmation');
  assert.deepEqual(service.calls, { permission: 0, find: 0, create: 0 });
  assert.equal((await coordinator.list('real-session')).length, 1);
  assert.equal((await coordinator.list('forged')).length, 0);
  const listTool = new ListCalendarDraftsTool(coordinator);
  assert.deepEqual(JSON.parse((await listTool.execute('{}', { conversationId: 'other' })).content), []);
  assert.equal((await tool.execute('{}')).success, false);
});

test('拒绝不明确日期、无效日期、过去时段、反向时段和异常提醒，不保存无效草案', async () => {
  const store = new MemoryKeyValueStore(), calendar = new CalendarCoordinator(store, fakeCalendar());
  for (const item of [null, input({ title: '' }), input({ startTime: '明晚七点' }),
    input({ startTime: '2027-02-30T19:00:00+08:00' }), input({ startTime: '2027-01-01T19:00:00' }),
    input({ startTime: iso(Date.now() - 86400000) }), input({ endTime: iso(Date.now() + 1000) }),
    input({ reminderMinutes: [-1] }), input({ reminderMinutes: [1.5] }), input({ reminderMinutes: [1, 2, 3, 4] })]) {
    await assert.rejects(calendar.prepare('session', '', [item]), /CALENDAR_INPUT/);
  }
  await assert.rejects(calendar.prepare('session', '', []), /CALENDAR_INPUT/);
  assert.equal(await store.get('calendar_data_v1'), '');
  assert.throws(() => calendarInputTime('2026-11-12 19:00 extra'), /CALENDAR_INPUT/);
});

test('计划生成可编辑的明晚日程，保留任务映射，跳过已完成任务，不改变原计划', async () => {
  const now = Date.parse('2026-11-11T22:00:00+08:00');
  const plan = { id: 'plan', conditions: { goal: '高数' }, tasks: [
    { id: 't1', title: '导数', day: 1, status: 'pending' },
    { id: 't2', title: '积分', day: 2, status: 'done' },
    { id: 't3', title: '练习', day: 3, status: 'pending' }] };
  const inputs = planCalendarInputs(plan, now);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].startTime, '2026-11-12T19:00:00+08:00');
  assert.equal(inputs[1].startTime, '2026-11-14T19:00:00+08:00');
  assert.equal(inputs[1].taskId, 't3');
  assert.deepEqual(inputs[0].reminderMinutes, [10]);
  assert.equal(plan.tasks[0].status, 'pending');
});

test('真实确认后保存系统 ID，重建仓库可恢复；重复草案和完成后的确认均不重复创建', async () => {
  const store = new MemoryKeyValueStore(), service = fakeCalendar();
  const calendar = new CalendarCoordinator(store, service);
  const item = input({ taskId: 'task' });
  const draft = await calendar.prepare('session', 'plan', [item]);
  assert.equal((await calendar.prepare('session', 'plan', [item])).id, draft.id);
  const result = await calendar.confirm(draft.id, draft.revision);
  assert.equal(result.status, 'completed');
  assert.equal(result.events[0].calendarId, 7);
  assert.equal(result.events[0].eventId, 1);
  const reopened = new CalendarCoordinator(store, service);
  const [saved] = await reopened.list();
  await reopened.confirm(saved.id, saved.revision);
  assert.equal(service.calls.create, 1);
  assert.match(calendar.summary(saved), /已创建 1\/1/);
});

test('修改草案使旧预览失效；并发重复确认只允许一次写入', async () => {
  const service = fakeCalendar(), calendar = new CalendarCoordinator(new MemoryKeyValueStore(), service);
  const draft = await calendar.prepare('session', '', [input()]);
  const edited = await calendar.edit(draft.id, draft.revision, draft.events[0].id, input({ title: '积分练习' }));
  await assert.rejects(calendar.confirm(draft.id, draft.revision), /CALENDAR_STALE/);
  assert.equal(service.calls.permission, 0);
  const results = await Promise.allSettled([calendar.confirm(edited.id, edited.revision),
    calendar.confirm(edited.id, edited.revision)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(service.calls.create, 1);
});

test('权限拒绝不查询或写入，保留待确认草案；不支持的平台也不会伪造成功', async () => {
  const service = fakeCalendar();
  service.requestPermission = async () => false;
  const calendar = new CalendarCoordinator(new MemoryKeyValueStore(), service);
  const draft = await calendar.prepare('session', '', [input()]);
  await assert.rejects(calendar.confirm(draft.id, draft.revision), /CALENDAR_PERMISSION/);
  assert.equal(service.calls.find, 0);
  assert.equal(service.calls.create, 0);
  assert.equal((await calendar.list())[0].events[0].state, 'pending');
  const unsupported = new CalendarCoordinator(new MemoryKeyValueStore(), new UnavailableCalendarService());
  const other = await unsupported.prepare('session', '', [input()]);
  await assert.rejects(unsupported.confirm(other.id, other.revision), /CALENDAR_UNAVAILABLE/);
});

test('一批部分失败时保留成功 ID，重试只处理未成功条目', async () => {
  const service = fakeCalendar(), create = service.createEvent;
  let fail = true;
  service.createEvent = async (event) => {
    if (event.title === '积分' && fail) throw new Error('calendar unavailable');
    return create(event);
  };
  const calendar = new CalendarCoordinator(new MemoryKeyValueStore(), service);
  const draft = await calendar.prepare('session', '', [input(), input({ title: '积分' })]);
  const first = await calendar.confirm(draft.id, draft.revision);
  assert.equal(first.status, 'pending');
  assert.deepEqual(first.events.map((event) => event.state), ['created', 'uncertain']);
  fail = false;
  const second = await calendar.confirm(first.id, first.revision);
  assert.equal(second.status, 'completed');
  assert.equal(service.events.size, 2);
  assert.equal(service.calls.create, 2);
  assert.equal(second.events[0].eventId, first.events[0].eventId);
});

test('系统已创建但返回异常时，重试先查询 identifier 找回原 ID，不重复写入', async () => {
  const service = fakeCalendar(), create = service.createEvent;
  service.createEvent = async (event) => { await create(event); throw new Error('response lost'); };
  const calendar = new CalendarCoordinator(new MemoryKeyValueStore(), service);
  const draft = await calendar.prepare('session', '', [input()]);
  const first = await calendar.confirm(draft.id, draft.revision);
  assert.equal(first.events[0].state, 'uncertain');
  const second = await calendar.confirm(first.id, first.revision);
  assert.equal(second.status, 'completed');
  assert.equal(second.events[0].eventId, 1);
  assert.equal(service.calls.create, 1);
});

test('系统创建后本地落盘失败，重建运行时可按写前记录恢复，仍只创建一条', async () => {
  const backing = new MemoryKeyValueStore(), service = fakeCalendar();
  let fail = true;
  const store = { get: (key) => backing.get(key), set: async (key, value) => {
    if (fail && value.includes('"state":"created"')) throw new Error('disk full');
    await backing.set(key, value);
  } };
  const calendar = new CalendarCoordinator(store, service);
  const draft = await calendar.prepare('session', '', [input()]);
  await assert.rejects(calendar.confirm(draft.id, draft.revision), /disk full/);
  fail = false;
  const reopened = new CalendarCoordinator(store, service), [saved] = await reopened.list();
  assert.equal(saved.events[0].state, 'writing');
  assert.equal((await reopened.confirm(saved.id, saved.revision)).status, 'completed');
  assert.equal(service.calls.create, 1);
});

test('写前记录保存失败或查询失败时不执行系统创建', async () => {
  const backing = new MemoryKeyValueStore(), service = fakeCalendar();
  let fail = false;
  const store = { get: (key) => backing.get(key), set: async (key, value) => {
    if (fail) throw new Error('disk full');
    await backing.set(key, value);
  } };
  const calendar = new CalendarCoordinator(store, service);
  const draft = await calendar.prepare('session', '', [input()]);
  fail = true;
  await assert.rejects(calendar.confirm(draft.id, draft.revision), /disk full/);
  assert.equal(service.calls.create, 0);
  fail = false;
  service.findEvent = async () => { throw new Error('query failed'); };
  const result = await calendar.confirm(draft.id, draft.revision);
  assert.equal(result.events[0].state, 'uncertain');
  assert.equal(service.calls.create, 0);
});

test('取消草案阻止后续执行，取消部分草案保留已创建日程', async () => {
  const service = fakeCalendar(), calendar = new CalendarCoordinator(new MemoryKeyValueStore(), service);
  const draft = await calendar.prepare('session', '', [input()]);
  const cancelled = await calendar.cancel(draft.id, draft.revision);
  await assert.rejects(calendar.confirm(cancelled.id, cancelled.revision), /CALENDAR_CANCELLED/);
  assert.equal(service.events.size, 0);
  const create = service.createEvent;
  service.createEvent = async (event) => { if (event.title === '失败项') throw new Error('fail'); return create(event); };
  const batch = await calendar.prepare('session', '', [input(), input({ title: '失败项' })]);
  const attempted = await calendar.confirm(batch.id, batch.revision);
  await calendar.cancel(attempted.id, attempted.revision);
  assert.equal(service.events.size, 1);
  assert.equal((await calendar.list()).find((item) => item.id === batch.id).events[0].eventId, 1);
});

test('取消回执丢失的独立日程后，同一会话不能用新草案重复写入同一时段', async () => {
  const service = fakeCalendar(), calendar = new CalendarCoordinator(new MemoryKeyValueStore(), service);
  const create = service.createEvent;
  service.createEvent = async (event) => { await create(event); throw new Error('response lost'); };
  const event = input();
  const draft = await calendar.prepare('session', '', [event]);
  const attempted = await calendar.confirm(draft.id, draft.revision);
  assert.equal(attempted.events[0].state, 'uncertain');
  await calendar.cancel(draft.id, attempted.revision);
  await assert.rejects(calendar.prepare('session', '', [{ ...event, reminderMinutes: [] }]), /CALENDAR_DUPLICATE/);
  assert.equal(service.calls.create, 1);
});

test('确认基础计划草案时重新核对待办，准备后已打卡的任务不写入', async () => {
  const service = fakeCalendar();
  const { MockModelClient } = await core.load('services/model/MockModelClient.ts');
  const runtime = createRuntime(new MockModelClient(), new MemoryKeyValueStore(), new UnavailableSpeechService(), '测试', service);
  const session = await runtime.agent.createConversation();
  await runtime.agent.send(session.id, '高数|1');
  const [plan] = await runtime.study.listPlans();
  const draft = await runtime.calendar.prepare(session.id, plan.id, planCalendarInputs(plan, Date.now()));
  await runtime.study.setTaskCompletion(plan.id, plan.tasks[0].id, true);
  const result = await runtime.calendar.confirm(draft.id, draft.revision);
  assert.equal(result.events[0].state, 'failed');
  assert.match(result.events[0].error, /已完成/);
  assert.equal(service.calls.create, 0);
});

test('相同计划任务不重复安排，关联不存在任务被拒绝，损坏数据不会被覆盖', async () => {
  const store = new MemoryKeyValueStore(), calendar = new CalendarCoordinator(store, fakeCalendar());
  await calendar.prepare('session', 'plan', [input({ taskId: 'task' })]);
  await assert.rejects(calendar.prepare('other', 'plan', [input({ taskId: 'task', title: '重复' })]), /CALENDAR_DUPLICATE/);
  const tool = new PrepareCalendarEventsTool(calendar, new StudyDataRepository(store));
  assert.equal((await tool.execute(JSON.stringify({ planId: 'missing', timeZone: 'Asia/Shanghai', events: [input()] }),
    { conversationId: 'session' })).success, false);
  for (const raw of ['{broken', '{"version":2,"drafts":[]}', '{"version":1,"drafts":[null]}']) {
    const broken = new MemoryKeyValueStore();
    await broken.set('calendar_data_v1', raw);
    const other = new CalendarCoordinator(broken, fakeCalendar());
    await assert.rejects(other.prepare('session', '', [input()]), /CALENDAR_STORAGE/);
    assert.equal(await broken.get('calendar_data_v1'), raw);
  }
});

test('取消部分草案后，已创建和结果不确定的任务仍阻止重复安排', async () => {
  const service = fakeCalendar(), calendar = new CalendarCoordinator(new MemoryKeyValueStore(), service);
  const create = service.createEvent;
  service.createEvent = async (event) => {
    if (event.taskId === 't2') throw new Error('uncertain');
    return create(event);
  };
  const draft = await calendar.prepare('session', 'plan', [input({ taskId: 't1' }),
    input({ taskId: 't2', title: '积分' })]);
  const attempted = await calendar.confirm(draft.id, draft.revision);
  await calendar.cancel(attempted.id, attempted.revision);
  for (const taskId of ['t1', 't2']) {
    await assert.rejects(calendar.prepare('session', 'plan', [input({ taskId })]), /CALENDAR_DUPLICATE/);
  }
  assert.equal(service.calls.create, 1);
});

test('拒绝重复日程与重复持久化 ID，保持原始记录供恢复', async () => {
  const store = new MemoryKeyValueStore(), calendar = new CalendarCoordinator(store, fakeCalendar());
  const item = input();
  await assert.rejects(calendar.prepare('session', '', [item, item]), /CALENDAR_INPUT/);
  const draft = await calendar.prepare('session', '', [item]);
  const raw = JSON.stringify({ version: 1, drafts: [draft, draft] });
  await store.set('calendar_data_v1', raw);
  await assert.rejects(calendar.list(), /CALENDAR_STORAGE/);
  assert.equal(await store.get('calendar_data_v1'), raw);
});

test('Agent 可准备和查询草案，切换模型保留日历实例，模型没有提交工具', async () => {
  const service = fakeCalendar();
  let calls = 0;
  const model = { complete: async (messages, tools) => {
    assert.ok(!tools.some((tool) => /confirm|commit|create_calendar/.test(tool.name)));
    assert.ok(tools.some((tool) => tool.name === 'list_study_plans'));
    if (++calls === 1) return { content: '', toolCalls: [{ id: 'cal', name: 'prepare_calendar_events',
      input: JSON.stringify({ timeZone: 'Asia/Shanghai', events: [input()] }) }] };
    if (calls === 2) {
      assert.equal(JSON.parse(messages.at(-1).content).success, true);
      return { content: '草案已准备，请在日程预览确认。', toolCalls: [] };
    }
    if (calls === 3) return { content: '', toolCalls: [{ id: 'list', name: 'list_calendar_drafts', input: '{}' }] };
    assert.equal(JSON.parse(JSON.parse(messages.at(-1).content).content)[0].status, 'pending');
    return { content: '尚未写入。', toolCalls: [] };
  } };
  const runtime = createRuntime(model, new MemoryKeyValueStore(), new UnavailableSpeechService(), 'test', service);
  const session = await runtime.agent.createConversation();
  assert.equal((await runtime.agent.send(session.id, '准备日程')).state, 'completed');
  const coordinator = runtime.calendar;
  runtime.replaceModel(model, 'another');
  assert.equal(runtime.calendar, coordinator);
  assert.equal((await runtime.agent.send(session.id, '查询')).state, 'completed');
  assert.equal(service.calls.create, 0);
  assert.equal(service.calls.permission, 0);
});
