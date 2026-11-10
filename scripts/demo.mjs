import assert from 'node:assert/strict';
import { compileCore } from './compile-core.mjs';

const core = await compileCore();
const { AppRuntime } = await core.load('bootstrap/Runtime.ts');
const { MockModelClient } = await core.load('services/model/MockModelClient.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { JsonSessionRepository } = await core.load('services/storage/JsonSessionRepository.ts');
const { JsonLearningRepository } = await core.load('services/storage/JsonLearningRepository.ts');
const { UnavailableSpeechService } = await core.load('platform/speech/UnavailableSpeechService.ts');

// 演示专用内存端口，不访问设备日历；真实适配由 D 注入。
class DemoCalendar {
  receipts = new Map();
  calls = [];
  failed = false;
  async readBusy() { return { readable: false, busy: [], reason: '模拟读取未授权，使用手工时段' }; }
  async reconcile(operation) {
    return this.receipts.get(operation.operationKey) || { status: 'failed', eventId: '', error: 'NOT_APPLIED' };
  }
  async apply(operation) {
    this.calls.push(operation);
    if (!this.failed && this.calls.length === 2) {
      this.failed = true;
      return { status: 'failed', eventId: '', error: '模拟单项写入失败，可重试' };
    }
    const result = { status: 'succeeded', eventId: operation.eventId || `demo-event-${this.calls.length}`, error: '' };
    this.receipts.set(operation.operationKey, result);
    return result;
  }
}
const calendar = new DemoCalendar();
const store = new MemoryKeyValueStore();
const runtime = new AppRuntime(new MockModelClient(), new JsonSessionRepository(store),
  new UnavailableSpeechService(), '离线模拟', new JsonLearningRepository(store), calendar);
const session = await runtime.agent.createConversation();
const tomorrow = Math.floor(Date.now() / 86400000) * 86400000 + 86400000;
const at = (minutes) => new Date(tomorrow + minutes * 60000).toISOString();
const startAt = at(0);
const available = [{ startAt: at(11 * 60), endAt: at(13 * 60) }];

console.log('大学生学习方向与行动规划 Agent：JSON 模拟模型 + 内存业务仓库 + 模拟日历。');
console.log('没有调用真实云模型，没有写入设备日历；时间戳使用明确 UTC。\n');

async function ask(label, tool, input) {
  const states = [];
  const result = await runtime.agent.send(session.id, JSON.stringify({ tool, input }), (state) => states.push(state));
  console.log(`${label}：${states.join(' → ')}`);
  assert.equal(result.state, 'completed', result.error);
  return runtime.learning.getState(session.id);
}

await ask('1. 选择就业入口，先收集部分条件', 'explore_learning_directions',
  { track: 'employment', major: '计算机', grade: '大三' });
let state = await ask('2. 补充基础、兴趣、目标与时间', 'explore_learning_directions',
  { background: '已有 Go 基础', interests: '后端接口', goal: '体验后端实习方向', weeks: 2, minutesPerWeek: 120 });
console.log('候选：' + state.candidates.map((path) => path.title).join(' / '));
await ask('3. 用户选择 Go 后端路径', 'select_learning_path', { pathId: 'go-backend' });
state = await ask('4. 形成两周任务提案', 'create_learning_plan', { startAt });
console.log('阶段任务：' + state.plan.tasks.map((task) => `第${task.week}周 ${task.title}（${task.estimatedMinutes}分钟）`).join('；'));
await ask('5. 按空闲时段安排未来一周', 'schedule_learning_tasks', { from: startAt, available, reminderMinutes: 0 });
state = await ask('6. 生成日历预览，尚未确认', 'preview_learning_calendar', {});
assert.equal(calendar.calls.length, 0);
console.log(`预览 ${state.preview.operations.length} 项；确认前日历调用数：${calendar.calls.length}`);

let preview = await runtime.learning.confirmCalendar(session.id, state.preview.id);
console.log('7. 模拟 B 的用户确认，逐项结果：' + preview.results.map((item) => item.status).join(' / '));
assert.ok(preview.results.some((item) => item.status === 'failed'));
preview = await runtime.learning.confirmCalendar(session.id, state.preview.id);
assert.ok(preview.results.every((item) => item.status === 'succeeded'));
console.log('8. 重试只补失败项；模拟调用总数：' + calendar.calls.length);

const completedId = state.plan.tasks[0].id;
await ask('9. 用户标记第一项完成', 'record_learning_progress', { taskId: completedId, status: 'done' });
await ask('10. 调整未完成任务的可用时段', 'schedule_learning_tasks', { from: startAt,
  available: [{ startAt: at(24 * 60 + 11 * 60), endAt: at(24 * 60 + 13 * 60) }], reminderMinutes: 0 });
state = await ask('11. 重新预览后续日程', 'preview_learning_calendar', {});
assert.ok(state.preview.operations.every((operation) => operation.taskId !== completedId));
console.log('调整操作：' + state.preview.operations.map((operation) => `${operation.kind} ${operation.taskId}`).join('；'));
await runtime.learning.confirmCalendar(session.id, state.preview.id);
console.log('已完成任务保持不动；后续模拟日程更新已确认。');
console.log(`\n持久业务计划版本：${(await runtime.learning.getState(session.id)).plan.version}`);
console.log(`配对历史消息数：${(await runtime.sessions.get(session.id)).messages.length}`);
