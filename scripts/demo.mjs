import { compileCore } from './compile-core.mjs';

const core = await compileCore();
const { createMockRuntime } = await core.load('bootstrap/Runtime.ts');
const runtime = createMockRuntime();
const conversation = await runtime.agent.createConversation();
console.log('离线共享逻辑演示：模拟模型 + 内存存储；没有调用云端模型。\n');
for (const text of ['我想准备下周的考试', '复习高数|3']) {
  console.log(`我：${text}`);
  const result = await runtime.agent.send(conversation.id, text);
  console.log(`助手：${result.reply || result.error}\n`);
  if (result.state !== 'completed') process.exitCode = 1;
}
console.log(`会话数：${(await runtime.sessions.list()).length}`);
console.log(`历史消息数：${(await runtime.sessions.get(conversation.id)).messages.length}`);
