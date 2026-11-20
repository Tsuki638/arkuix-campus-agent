import { compileCore } from './compile-core.mjs';

const core = await compileCore();
const { BackendApiClient } = await core.load('services/backend/BackendApiClient.ts');
const baseUrl = process.env.BACKEND_BASE_URL || 'http://127.0.0.1:8080';
const transport = {
  get: async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    return { statusCode: response.status, body: await response.text() };
  }
};

try {
  const client = new BackendApiClient(transport, baseUrl);
  const info = await client.getSystemInfo();
  console.log(`前端客户端 → Java 后端联调通过：${info.application}，接口 ${info.apiVersion}，阶段 ${info.phase}。`);
} catch (error) {
  console.error(error.code ? `${error.code}: ${error.message}` : '后端联调失败，请检查后端运行状态。');
  process.exitCode = 1;
}
