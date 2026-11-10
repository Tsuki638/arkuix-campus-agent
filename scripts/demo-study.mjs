import { compileCore } from './compile-core.mjs';
import assert from 'node:assert/strict';

const core = await compileCore();
const { createMockRuntime } = await core.load('bootstrap/Runtime.ts');
const runtime = createMockRuntime();
const conversation = await runtime.agent.createConversation();
console.log('学习任务规划助手：离线模拟模型 + 内存存储；没有调用云端模型。');
console.log('以下 JSON 是离线参数输入，不代表已经完成自然语言或设备验收。\n');
const turns = [
  { label: '1. 缺少条件，先澄清', input: { goal: '复习高数' }, state: 'completed' },
  { label: '2. 补充时间和任务，继承上一轮目标', input: { days: 3, minutesPerDay: 90,
    tasks: [{ name: '极限', minutes: 60 }, { name: '导数', minutes: 90 },
      { name: '积分', minutes: 120 }] }, state: 'completed' },
  { label: '3. 每天缩短到 60 分钟，指出时间不足', input: { minutesPerDay: 60 }, state: 'failed' },
  { label: '4. 延长到 5 天，重新生成可行计划', input: { days: 5 }, state: 'completed' }
];
for (const turn of turns) {
  const text = JSON.stringify(turn.input);
  const states = [];
  console.log(turn.label);
  console.log(`我：${text}`);
  const result = await runtime.agent.send(conversation.id, text, (state) => states.push(state));
  console.log(`状态：${states.join(' → ')}`);
  console.log(`助手：${result.reply || result.error}\n`);
  assert.equal(result.state, turn.state);
}
console.log(`会话数：${(await runtime.sessions.list()).length}`);
console.log(`历史消息数：${(await runtime.sessions.get(conversation.id)).messages.length}`);
