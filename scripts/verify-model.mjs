import { compileCore } from './compile-core.mjs';

// 成员 C 的真实模型连通性验证。设备端 OhosJsonTransport 是 .ets，无法在 Node 运行，
// 这里用 fetch 复刻同一个 JsonTransport 端口（同样的 Bearer 头、超时、状态码分类），
// 只验证 CompatibleModelClient 的工具协议往返，不代替实机验收。
//
// 用法：设置环境变量后运行 `node scripts/verify-model.mjs`
//   MODEL_ENDPOINT  完整 HTTPS /chat/completions 地址
//   MODEL_MODEL     模型名称
//   MODEL_API_KEY   运行时密钥（只经 Authorization 头发送，禁止提交仓库）
// 缺少任一变量时跳过并以 2 退出，不会误报为已通过真实调用。

const endpoint = process.env.MODEL_ENDPOINT || '';
const model = process.env.MODEL_MODEL || '';
const apiKey = process.env.MODEL_API_KEY || '';

if (!endpoint || !model || !apiKey) {
  console.log('跳过真实模型验证：未提供 MODEL_ENDPOINT / MODEL_MODEL / MODEL_API_KEY。');
  console.log('这不影响单元测试；仅在需要联调真实模型时设置上述环境变量。');
  process.exit(2);
}

const core = await compileCore();
const { CompatibleModelClient } = await core.load('services/model/CompatibleModelClient.ts');
const { createRuntime } = await core.load('bootstrap/Runtime.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { UnavailableSpeechService } = await core.load('platform/speech/UnavailableSpeechService.ts');

const transport = {
  async post(request) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.bearerToken}` },
        body: request.body,
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error('MODEL_AUTH: 模型鉴权失败，请检查运行时密钥。');
      }
      if (response.status === 429) {
        throw new Error('MODEL_RATE_LIMIT: 模型服务限流，请稍后重试。');
      }
      if (!response.ok) {
        throw new Error(`MODEL_HTTP: 模型请求失败，HTTP ${response.status}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }
};

const client = new CompatibleModelClient(transport, { endpoint, model, apiKey });
const runtime = createRuntime(client, new MemoryKeyValueStore(), new UnavailableSpeechService(), '真实模型验证');

console.log(`正在使用 ${model} 验证完整 Agent 工具流程……`);
try {
  const session = await runtime.agent.createConversation();
  const result = await runtime.agent.send(session.id,
    '请调用 create_study_plan 工具，为复习高数制定 3 天的计划，执行后说明结果。');
  if (result.state !== 'completed') { throw new Error(result.error); }
  const results = result.conversation.messages.filter((message) => message.role === 'tool')
    .map((message) => JSON.parse(message.content));
  if (!results.some((tool) => tool.name === 'create_study_plan' && tool.success) ||
      (await runtime.study.listPlans()).length === 0) {
    throw new Error('本次未完成学习计划工具调用，不能计为工具流程验收。');
  }
  console.log('真实模型 → 工具执行并保存 → 工具结果回传 → 最终答复：验证通过。');
} catch (error) {
  console.error('真实模型验证失败：', error.message);
  process.exit(1);
}
