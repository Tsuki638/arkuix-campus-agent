import { compileCore } from './compile-core.mjs';

// 成员 C 的真实模型连通性验证。设备端 OhosJsonTransport 是 .ets，无法在 Node 运行，
// 这里用 fetch 复刻同一个 JsonTransport 端口（同样的 Bearer 头、超时、状态码分类），
// 只验证 CompatibleModelClient 的工具协议往返，不代替实机验收。
//
// 用法：设置环境变量后运行 `node scripts/verify-model.mjs`
//   MODEL_ENDPOINT  完整 HTTPS /chat/completions 地址
//   MODEL_MODEL     模型名称
//   MODEL_API_KEY   运行时密钥（只经 Authorization 头发送，禁止提交仓库）
// 缺少任一变量时脚本跳过并以 0 退出，不算失败。

const endpoint = process.env.MODEL_ENDPOINT || '';
const model = process.env.MODEL_MODEL || '';
const apiKey = process.env.MODEL_API_KEY || '';

if (!endpoint || !model || !apiKey) {
  console.log('跳过真实模型验证：未提供 MODEL_ENDPOINT / MODEL_MODEL / MODEL_API_KEY。');
  console.log('这不影响单元测试；仅在需要联调真实模型时设置上述环境变量。');
  process.exit(0);
}

const core = await compileCore();
const { CompatibleModelClient } = await core.load('services/model/CompatibleModelClient.ts');
const { StudyPlanTool } = await core.load('agent/tools/StudyPlanTool.ts');
const { makeMessage } = await core.load('contracts/Models.ts');

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
const tool = new StudyPlanTool();

console.log(`正在向 ${model} 发起一次带工具定义的请求……`);
try {
  const reply = await client.complete([makeMessage('user', '帮我制定一个 3 天的高数复习计划')], [tool.definition()]);
  if (reply.toolCalls.length > 0) {
    console.log('模型返回工具调用：', reply.toolCalls.map((c) => c.name).join(', '));
    const result = await tool.execute(reply.toolCalls[0].input);
    console.log('工具执行结果：', result.success ? '成功' : '失败', '-', result.content.slice(0, 120));
  } else {
    console.log('模型返回纯文本（未触发工具）：', reply.content.slice(0, 200));
  }
  console.log('真实模型往返验证通过。');
} catch (error) {
  console.error('真实模型验证失败：', error.message);
  process.exit(1);
}
