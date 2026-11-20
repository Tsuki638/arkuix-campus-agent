import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCore } from '../../scripts/compile-core.mjs';

const core = await compileCore();
const { AccountConnection } = await core.load('services/backend/AccountConnection.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { JsonSessionRepository } = await core.load('services/storage/JsonSessionRepository.ts');
const { UnavailableSpeechService } = await core.load('platform/speech/UnavailableSpeechService.ts');
const { UnavailableCalendarService } = await core.load('platform/calendar/UnavailableCalendarService.ts');
const { WorkspaceApi } = await core.load('services/backend/WorkspaceApi.ts');

const device = '235bb8bc-95b6-4f90-b577-6d0fff41cb77';
const token = 't'.repeat(43);
const address = 'https://campus.example.test';
const user = { username: 'student-one' };
const password = 'test-auth-passphrase';
const sessionKey = 'backend_session_v2';
const ok = (data, statusCode = 200) =>
  ({ statusCode, body: JSON.stringify({ code: 'OK', message: 'success', data }) });

function connection(store, transport, expired = () => {}) {
  return new AccountConnection(transport, address, store, device,
    new UnavailableSpeechService(), new UnavailableCalendarService(), expired);
}

test('账号恢复与退出仅使用会话令牌，旧记录由用户操作触发导入', async () => {
  const calls = [];
  const store = new MemoryKeyValueStore();
  await new JsonSessionRepository(store).save({ id: 'old', title: '本机旧记录', messages: [], updatedAt: 1 });
  const transport = {
    async request(input) {
      calls.push(input);
      const route = new URL(input.url).pathname;
      if (route.endsWith('/register')) {
        assert.equal(input.token, '');
        assert.deepEqual(JSON.parse(input.body), { username: user.username, password, deviceId: device });
        return ok({ token, user, expiresAt: Date.now() + 3600 }, 201);
      }
      assert.equal(input.token, token);
      if (route.endsWith('/me')) return ok(user);
      if (route.endsWith('/model/preference')) {
        return { statusCode: 404, body: JSON.stringify({ code: 'NOT_FOUND', message: '接口不存在。' }) };
      }
      if (route.endsWith('/model')) return ok({ configured: true, model: 'test-model', endpoint: 'https://model.example.test' });
      if (route.endsWith('/import') && input.method === 'GET') return ok(false);
      if (route.endsWith('/import') && input.method === 'POST') {
        assert.equal(JSON.parse(input.body).conversations[0].id, 'old');
        return ok(null);
      }
      if (route.endsWith('/logout')) return ok(null);
      throw new Error('Unexpected route');
    }
  };
  const first = connection(store, transport);
  assert.deepEqual(await first.signIn(user.username, password, true), user);
  await first.openWorkspace();
  assert(!calls.some((call) => call.url.endsWith('/import')));
  assert.deepEqual(JSON.parse(await store.get(sessionKey)), { baseUrl: address, token });
  assert(!(await store.get(sessionKey)).includes(password));

  const reopened = connection(store, transport);
  assert.deepEqual(await reopened.restore(), user);
  assert.equal(await reopened.hasLegacyHistory(), true);
  await reopened.importLegacyHistory();
  assert.equal(await reopened.hasLegacyHistory(), false);
  assert.equal((await new JsonSessionRepository(store).get('old')).title, '本机旧记录');
  await reopened.signOut();
  assert.equal(reopened.isSignedIn(), false);
  assert.equal(await store.get(sessionKey), '');
});

test('账号保存模型选择，重新登录后发送消息无需再次提交密钥', async () => {
  const defaultModel = { endpoint: 'https://api.deepseek.com/chat/completions', model: 'default-model', configured: true };
  const customModel = { endpoint: 'https://api.moonshot.cn/v1/chat/completions', model: 'custom-model', configured: true };
  const apiKey = 'fixture-custom-key';
  const conversation = { id: 'chat', title: '学习空间', messages: [], updatedAt: 1 };
  let preference = { mode: 'default', defaultModel, customModel: null };
  let writes = 0;
  const transport = {
    async request(input) {
      const route = new URL(input.url).pathname;
      if (route.endsWith('/login')) return ok({ token, user });
      assert.equal(input.token, token);
      if (route.endsWith('/logout')) return ok(null);
      if (route.endsWith('/model/preference')) {
        if (input.method === 'PUT') {
          assert.deepEqual(JSON.parse(input.body), {
            mode: 'custom', customModel: { endpoint: customModel.endpoint, model: customModel.model, apiKey }
          });
          preference = { mode: 'custom', defaultModel, customModel };
          writes++;
        }
        return ok(preference);
      }
      if (route.endsWith('/turns')) {
        const { requestId, ...request } = JSON.parse(input.body);
        assert(requestId);
        assert.deepEqual(request, { text: '你好', useSavedModel: true });
        return ok({ state: 'completed', reply: '你好', error: '', conversation }, 202);
      }
      throw new Error('Unexpected route');
    }
  };
  const first = connection(new MemoryKeyValueStore(), transport);
  await first.signIn(user.username, password, false);
  const original = await first.openWorkspace();
  assert.equal(original.modeLabel, defaultModel.model);
  await original.accountModel.save('custom', { endpoint: customModel.endpoint, model: customModel.model, apiKey });
  await first.signOut();

  const nextDevice = connection(new MemoryKeyValueStore(), transport);
  await nextDevice.signIn(user.username, password, false);
  const restored = await nextDevice.openWorkspace();
  assert.equal(restored.modeLabel, customModel.model);
  assert.deepEqual(restored.accountModel.preference, preference);
  await restored.agent.send(conversation.id, '你好');
  assert.equal(writes, 1);
});

test('失效的登录会话清理本机令牌，并阻止向普通 HTTP 地址提交密码', async () => {
  const store = new MemoryKeyValueStore();
  await store.set(sessionKey, JSON.stringify({ baseUrl: address, token }));
  let expired = 0;
  let requests = 0;
  const transport = {
    async request() {
      requests++;
      return { statusCode: 401, body: JSON.stringify({ code: 'AUTH_EXPIRED', message: '已失效', data: null }) };
    }
  };
  const account = connection(store, transport, () => { expired++; });
  assert.equal(await account.restore(), null);
  assert.equal(await account.restore(), null);
  assert.equal(expired, 1);
  assert.equal(await store.get(sessionKey), '');
  const insecure = new WorkspaceApi(transport, 'http://192.0.2.1:8080');
  await assert.rejects(() => insecure.account('POST', '/login', '{}'), { code: 'HTTPS_REQUIRED' });
  assert.equal(requests, 1);
});
