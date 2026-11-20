import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCore } from '../../scripts/compile-core.mjs';

const core = await compileCore();
const { BackendApiClient } = await core.load('services/backend/BackendApiClient.ts');
const info = { application: 'campus-agent-backend', apiVersion: 'v1',
  architecture: 'frontend-backend-separated', phase: 'scaffold' };

test('后端客户端使用统一版本前缀、去除根地址尾斜线并读取响应数据', async () => {
  let requestedUrl;
  const client = new BackendApiClient({ get: async (url) => {
    requestedUrl = url;
    return { statusCode: 200, body: JSON.stringify({ code: 'OK', message: 'success', data: info }) };
  } }, ' http://127.0.0.1:8080/// ');
  assert.deepEqual(await client.getSystemInfo(), info);
  assert.equal(requestedUrl, 'http://127.0.0.1:8080/api/v1/system/info');
});

test('后端地址拒绝空值、非 HTTP 协议、内嵌凭据和查询参数', () => {
  for (const baseUrl of ['', 'localhost:8080', 'file:///tmp',
    'https://user:password@example.com', 'https://example.com?token=secret']) {
    assert.throws(() => new BackendApiClient({}, baseUrl), { code: 'BACKEND_CONFIG' });
  }
});

test('后端网络与 HTTP 错误分类且不透传原始响应', async () => {
  const disconnected = new BackendApiClient({ get: async () => {
    throw new Error('private transport detail');
  } }, 'http://127.0.0.1:8080');
  await assert.rejects(disconnected.getSystemInfo(), { code: 'BACKEND_TRANSPORT',
    message: '无法连接后端服务，请检查地址与网络。' });
  const failed = new BackendApiClient({ get: async () => ({ statusCode: 503, body: 'private response' }) },
    'http://127.0.0.1:8080');
  await assert.rejects(failed.getSystemInfo(), { code: 'BACKEND_HTTP', message: '后端请求失败，HTTP 503' });
});

test('后端客户端拒绝非法 JSON、失败信封、缺失字段和不兼容版本', async () => {
  for (const body of ['not json', 'null', '[]', '{}', JSON.stringify({ code: 'FAILED', message: 'detail' }),
    JSON.stringify({ code: 'OK', message: 'success', data: {} }),
    JSON.stringify({ code: 'OK', message: 'success', data: { ...info, apiVersion: 'v2' } })]) {
    const client = new BackendApiClient({ get: async () => ({ statusCode: 200, body }) },
      'http://127.0.0.1:8080');
    await assert.rejects(client.getSystemInfo(), { code: 'BACKEND_RESPONSE' });
  }
});
