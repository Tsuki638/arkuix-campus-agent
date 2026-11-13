import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { compileCore, workspace } from '../scripts/compile-core.mjs';

const core = await compileCore();
const { AgentEngine } = await core.load('agent/AgentEngine.ts');
const { ToolRegistry } = await core.load('agent/ToolRegistry.ts');
const { StudyPlanTool } = await core.load('agent/tools/StudyPlanTool.ts');
const { MockModelClient } = await core.load('services/model/MockModelClient.ts');
const { CompatibleModelClient } = await core.load('services/model/CompatibleModelClient.ts');
const { trimContext, DEFAULT_MAX_CONTEXT_CHARS } = await core.load('services/model/ContextTrimmer.ts');
const { JsonSessionRepository } = await core.load('services/storage/JsonSessionRepository.ts');
const { StudyDataRepository } = await core.load('services/storage/StudyDataRepository.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { createMockRuntime } = await core.load('bootstrap/Runtime.ts');
const { describeAgentError, errorCodeOf, needsModelSettings } = await core.load('services/model/ErrorText.ts');
const { makeMessage } = await core.load('contracts/Models.ts');

function setup(model = new MockModelClient(), maxSteps = 4) {
  const store = new MemoryKeyValueStore();
  const sessions = new JsonSessionRepository(store);
  const registry = new ToolRegistry();
  registry.register(new StudyPlanTool());
  return { store, sessions, registry, agent: new AgentEngine(model, registry, sessions, maxSteps) };
}

test('两轮对话保留上下文，工具调用及结果配对，能够回看与删除', async () => {
  const runtime = createMockRuntime();
  const session = await runtime.agent.createConversation();
  const first = await runtime.agent.send(session.id, '我要备考');
  assert.equal(first.state, 'completed');
  assert.match(first.reply, /第 1 轮/);
  const states = [];
  const second = await runtime.agent.send(session.id, '复习高数|3', (state) => states.push(state));
  assert.equal(second.state, 'completed');
  assert.match(second.reply, /第 3 天/);
  assert.deepEqual(states, ['thinking', 'using_tool', 'thinking', 'completed']);
  const saved = await runtime.sessions.get(session.id);
  assert.equal(saved.messages.length, 6);
  const call = saved.messages[3].toolCalls[0];
  assert.equal(saved.messages[4].toolCallId, call.id);
  assert.equal(saved.messages[4].role, 'tool');
  await runtime.sessions.delete(session.id);
  assert.equal(await runtime.sessions.get(session.id), null);
});

test('工具参数拒绝非法 JSON、空目标和越界天数', async () => {
  const tool = new StudyPlanTool();
  for (const input of ['bad', 'null', '{}', '{"goal":"","days":2}',
    '{"goal":"高数","days":0}', '{"goal":"高数","days":31}', '{"goal":"高数","days":1.5}']) {
    assert.equal((await tool.execute(input)).success, false, input);
  }
  assert.equal((await tool.execute('{"goal":"高数","days":1}')).success, true);
});

test('未知工具和抛错工具返回失败结果，不伪造成功', async () => {
  const registry = new ToolRegistry();
  assert.equal((await registry.execute('missing', '{}')).success, false);
  registry.register({
    definition: () => ({ name: 'broken', description: '', parametersJson: '{}' }),
    execute: async () => { throw new Error('internal'); }
  });
  const result = await registry.execute('broken', '{}');
  assert.equal(result.success, false);
  assert.match(result.content, /TOOL_FAILED/);
  assert.throws(() => registry.register(new StudyPlanTool()) || registry.register(new StudyPlanTool()), /DUPLICATE_TOOL/);
});

test('模型持续要求工具时在指定步数停止，历史内没有未配对调用', async () => {
  let calls = 0;
  const model = { complete: async () => ({ content: '', toolCalls: [{
    id: `call-${++calls}`, name: 'missing', input: '{}'
  }] }) };
  const { agent, sessions } = setup(model, 2);
  const session = await agent.createConversation();
  const result = await agent.send(session.id, '执行');
  assert.equal(calls, 2);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /STEP_LIMIT/);
  assert.deepEqual((await sessions.get(session.id)).messages.map((message) => message.role),
    ['user', 'assistant', 'tool', 'assistant', 'tool']);
});

test('模型失败保留用户输入，下一轮可以恢复，空输入不会写入', async () => {
  let fail = true;
  const model = { complete: async () => {
    if (fail) throw new Error('NETWORK_TIMEOUT: 请求超时');
    return { content: '已恢复', toolCalls: [] };
  } };
  const { agent, sessions } = setup(model);
  const session = await agent.createConversation();
  await assert.rejects(agent.send(session.id, '   '), /EMPTY_INPUT/);
  const result = await agent.send(session.id, '请帮忙');
  assert.equal(result.state, 'failed');
  assert.equal((await sessions.get(session.id)).messages.length, 1);
  fail = false;
  assert.equal((await agent.send(session.id, '继续')).reply, '已恢复');
});

test('同一会话并发发送会被拒绝，UI 监听异常不打断 Agent', async () => {
  let release;
  const model = { complete: () => new Promise((resolve) => { release = resolve; }) };
  const { agent } = setup(model);
  const session = await agent.createConversation();
  const first = agent.send(session.id, '第一条', () => { throw new Error('render error'); });
  await assert.rejects(agent.send(session.id, '重复发送'), /SESSION_BUSY/);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  release({ content: '完成', toolCalls: [] });
  assert.equal((await first).state, 'completed');
});

test('会话写入串行化，保存使用快照，重建仓库能读取相同数据', async () => {
  const { agent, store, sessions } = setup();
  const records = await Promise.all(Array.from({ length: 5 }, () => agent.createConversation()));
  assert.equal((await sessions.list()).length, 5);
  const operation = sessions.save(records[0]);
  records[0].title = '不应改变已提交快照';
  await operation;
  const reopened = new JsonSessionRepository(store);
  assert.equal((await reopened.get(records[0].id)).title, '新会话');
});

test('写入失败会报告错误且不会永久堵塞后续写入队列', async () => {
  const backing = new MemoryKeyValueStore();
  let fail = true;
  const store = {
    get: (key) => backing.get(key),
    set: async (key, value) => { if (fail) throw new Error('disk full'); await backing.set(key, value); }
  };
  const sessions = new JsonSessionRepository(store);
  const record = { id: 'one', title: '测试', updatedAt: 1, messages: [] };
  await assert.rejects(sessions.save(record), /disk full/);
  fail = false;
  await sessions.save(record);
  assert.equal((await sessions.list()).length, 1);
});

test('历史损坏或版本不兼容时拒绝覆盖原始文件', async () => {
  for (const raw of ['{broken', '{"version":2,"conversations":[]}',
    '{"version":1,"conversations":[{"id":"x","title":"x","updatedAt":1,"messages":[null]}]}']) {
    const { store, sessions, agent } = setup();
    await store.set('sessions_v1', raw);
    await assert.rejects(sessions.list(), /STORAGE_CORRUPT/);
    await assert.rejects(agent.createConversation(), /STORAGE_CORRUPT/);
    assert.equal(await store.get('sessions_v1'), raw);
  }
});

test('相同历史仓库可使用文件端口恢复超过 8KB 的消息；设备文件 API 另行验收', async () => {
  const directory = await mkdtemp(path.join(workspace, '.generated', 'history-test-'));
  class NodeFileStore {
    async get(key) {
      try { return await readFile(path.join(directory, `${key}.json`), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
    }
    async set(key, value) {
      const target = path.join(directory, `${key}.json`);
      await writeFile(`${target}.tmp`, value, 'utf8');
      await rename(`${target}.tmp`, target);
    }
  }
  const sessions = new JsonSessionRepository(new NodeFileStore());
  await sessions.save({ id: 'persisted', title: '长历史', updatedAt: 1,
    messages: [makeMessage('user', '学习'.repeat(5000))] });
  const reopened = new JsonSessionRepository(new NodeFileStore());
  assert.equal((await reopened.get('persisted')).messages[0].content.length, 10000);
  await reopened.delete('persisted');
  assert.equal((await new JsonSessionRepository(new NodeFileStore()).list()).length, 0);
});

const settings = { endpoint: 'https://model.example.invalid/v1/chat/completions',
  model: 'test-model', apiKey: 'test-only-not-a-real-key' };

test('模型适配器发送工具 schema 和调用 ID，密钥仅用于请求头端口', async () => {
  let request;
  const transport = { post: async (value) => {
    request = value;
    return JSON.stringify({ choices: [{ message: { role: 'assistant', content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'create_study_plan',
        arguments: '{"goal":"高数","days":2}' } }] } }] });
  } };
  const model = new CompatibleModelClient(transport, settings);
  const reply = await model.complete([makeMessage('user', '准备考试')], [new StudyPlanTool().definition()]);
  assert.equal(reply.toolCalls[0].id, 'call-1');
  assert.equal(request.bearerToken, settings.apiKey);
  assert.equal(request.body.includes(settings.apiKey), false);
  const payload = JSON.parse(request.body);
  assert.equal(payload.stream, false);
  assert.equal(payload.tools[0].function.parameters.type, 'object');
  const assistant = makeMessage('assistant', '');
  assistant.toolCalls = reply.toolCalls;
  const tool = makeMessage('tool', '{"success":true}');
  tool.toolCallId = 'call-1';
  await model.complete([assistant, tool], []);
  const followup = JSON.parse(request.body);
  assert.equal(followup.messages[0].tool_calls[0].id, 'call-1');
  assert.equal(followup.messages[1].tool_call_id, 'call-1');
  assert.equal('tools' in followup, false);
});

test('模型配置和异常响应被拒绝；供应商响应全文不暴露给界面', async () => {
  assert.throws(() => new CompatibleModelClient({}, { ...settings, endpoint: 'http://plain.example' }), /MODEL_CONFIG/);
  for (const response of ['bad json', '{}', '{"choices":[]}',
    '{"choices":[{"message":{"role":"assistant","content":""}}]}',
    '{"choices":[{"message":{"role":"assistant","tool_calls":[{}]}}]}']) {
    const model = new CompatibleModelClient({ post: async () => response }, settings);
    await assert.rejects(model.complete([makeMessage('user', 'hi')], []), /MODEL_RESPONSE/);
  }
});

test('内置模拟运行时明确标记语音未接入', async () => {
  const runtime = createMockRuntime();
  assert.equal(runtime.speech.isAvailable(), false);
  await assert.rejects(runtime.speech.recognizeOnce(), /SPEECH_UNAVAILABLE/);
  await assert.rejects(runtime.speech.speak('hello'), /SPEECH_UNAVAILABLE/);
});

test('传输异常收敛为固定 MODEL_* 错误码，且不透传原始报文', async () => {
  const cases = [
    ['HTTP 401 Unauthorized', /MODEL_AUTH/],
    ['invalid_api_key', /MODEL_AUTH/],
    ['HTTP 429 Too Many Requests', /MODEL_RATE_LIMIT/],
    ['connect ETIMEDOUT', /MODEL_TIMEOUT/],
    ['The operation was aborted', /MODEL_TIMEOUT/],
    ['HTTP 502 Bad Gateway', /MODEL_HTTP/],
    ['getaddrinfo ENOTFOUND model.example', /MODEL_TRANSPORT/]
  ];
  for (const [message, pattern] of cases) {
    const model = new CompatibleModelClient({ post: async () => { throw new Error(message); } }, settings);
    await assert.rejects(model.complete([makeMessage('user', 'hi')], []), pattern, message);
  }
  // 传输层已分类的错误码原样透传，不二次改写。
  const passthrough = new CompatibleModelClient(
    { post: async () => { throw new Error('MODEL_RATE_LIMIT: 模型服务限流，请稍后重试。'); } }, settings);
  await assert.rejects(passthrough.complete([makeMessage('user', 'hi')], []),
    /^Error: MODEL_RATE_LIMIT: 模型服务限流，请稍后重试。$/);
});

test('上下文裁剪保留系统消息并按工具分组丢弃最早历史，不拆散配对', async () => {
  const system = makeMessage('system', 'S');
  const assistant = makeMessage('assistant', '');
  assistant.toolCalls = [{ id: 'call-x', name: 'create_study_plan', input: '{}' }];
  const tool = makeMessage('tool', 'result');
  tool.toolCallId = 'call-x';
  const recent = makeMessage('user', '最近一条');
  const budget = system.content.length + assistant.content.length + 20 + tool.content.length + recent.content.length;
  const trimmed = trimContext([system, assistant, tool, recent], budget - 1);
  assert.deepEqual(trimmed.map((m) => m.role), ['system', 'assistant', 'tool', 'user']);
  // 预算不足以容纳工具组时，整组一起丢弃，绝不留下孤立的 tool 结果。
  const tight = trimContext([system, assistant, tool, recent],
    system.content.length + recent.content.length + 1);
  assert.deepEqual(tight.map((m) => m.role), ['system', 'user']);
  assert.equal(tight.some((m) => m.role === 'tool'), false);
  assert.ok(DEFAULT_MAX_CONTEXT_CHARS > 0);
});

test('适配器按上下文预算裁剪后再发送，保留系统消息与最新用户输入', async () => {
  let request;
  const transport = { post: async (value) => {
    request = value;
    return JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
  } };
  const model = new CompatibleModelClient(transport, settings, { maxContextChars: 40 });
  const system = makeMessage('system', 'SYS');
  const history = Array.from({ length: 20 }, (_, i) => makeMessage('user', `历史消息${i}内容较长`.repeat(3)));
  const latest = makeMessage('user', '最新');
  await model.complete([system, ...history, latest], []);
  const payload = JSON.parse(request.body);
  assert.equal(payload.messages[0].role, 'system');
  assert.equal(payload.messages[payload.messages.length - 1].content, '最新');
  assert.ok(payload.messages.length < history.length + 2);
  assert.throws(() => new CompatibleModelClient(transport, settings, { maxContextChars: 0 }), /MODEL_CONFIG/);
});

test('学习数据仓库独立于会话存储，可持久化计划与打卡并跨实例读取', async () => {
  const store = new MemoryKeyValueStore();
  const repo = new StudyDataRepository(store);
  const plan = { id: 'plan-1', createdAt: 10,
    conditions: { goal: '高数', dailyMinutes: 60, startDate: '2026-10-28' },
    tasks: [{ id: 't1', title: '第一章', day: 1, status: 'pending' },
      { id: 't2', title: '第二章', day: 2, status: 'pending' }] };
  await repo.addPlan(plan);
  await repo.updateTask('plan-1', 't1', 'done');
  await repo.addRecord({ planId: 'plan-1', taskId: 't1', completedAt: 99 });
  // 会话仓库与学习仓库使用不同 key，互不覆盖。
  const sessions = new JsonSessionRepository(store);
  await sessions.save({ id: 's1', title: '会话', updatedAt: 1, messages: [] });
  const reopened = new StudyDataRepository(store);
  const loaded = await reopened.getPlan('plan-1');
  assert.equal(loaded.tasks.find((t) => t.id === 't1').status, 'done');
  assert.equal(loaded.tasks.find((t) => t.id === 't2').status, 'pending');
  assert.equal((await reopened.listRecords('plan-1')).length, 1);
  assert.equal((await sessions.list()).length, 1);
  await assert.rejects(reopened.updateTask('missing', 't1', 'done'), /STUDY_NOT_FOUND/);
  await assert.rejects(reopened.updateTask('plan-1', 'missing', 'done'), /STUDY_NOT_FOUND/);
});

test('学习数据损坏或版本不兼容时拒绝覆盖原始文件', async () => {
  for (const raw of ['{broken', '{"version":2,"plans":[],"records":[]}',
    '{"version":1,"plans":[{"id":"p","createdAt":1,"conditions":null,"tasks":[]}],"records":[]}']) {
    const store = new MemoryKeyValueStore();
    await store.set('study_data_v1', raw);
    const repo = new StudyDataRepository(store);
    await assert.rejects(repo.listPlans(), /STORAGE_CORRUPT/);
    assert.equal(await store.get('study_data_v1'), raw);
  }
});

// ===== 界面错误文案（GitHub #6 失败反馈 / #7 存储异常反馈）=====

test('界面文案去掉英文错误码前缀，并给出可继续操作的提示', () => {
  const cases = [
    ['MODEL_CONFIG: 请提供 HTTPS 接口、模型名称和运行时密钥。', /模型设置/],
    ['MODEL_AUTH: 模型鉴权失败，请检查运行时密钥。', /重新填写/],
    ['MODEL_TIMEOUT: 模型请求超时，请检查网络后重试。', /重新发送/],
    ['MODEL_TRANSPORT: 无法连接模型服务，请检查网络后重试。', /离线计划与历史/],
    ['MODEL_RATE_LIMIT: 模型服务限流，请稍后重试。', /稍等片刻/],
    ['STORAGE_CORRUPT: 会话文件损坏或版本不兼容。请先备份，避免覆盖历史。', /备份/],
    ['CALENDAR_STORAGE: 日历记录损坏或版本不兼容，已保留原始数据。', /保留原始数据/],
    ['SPEECH_PERMISSION_DENIED: 未获得麦克风权限。', /继续用文字输入/],
    ['CALENDAR_UNAVAILABLE: Android 暂不支持', /应用内日程草案/]
  ];
  for (const [raw, pattern] of cases) {
    const text = describeAgentError(raw);
    assert.match(text, pattern, raw);
    assert.doesNotMatch(text, /^[A-Z][A-Z_]+:/, raw);
    assert.ok(text.length > 0, raw);
  }
  assert.equal(describeAgentError(''), '');
  assert.equal(describeAgentError(undefined), '');
  assert.equal(describeAgentError(null), '');
});

test('未分类异常与含凭据的响应体不会透传到界面', () => {
  // 拼接构造，避免测试夹具被误判为真实凭据。
  const fakeKey = 'sk' + '-abcdefghijklmnopqrstuvwxyz';
  const leaks = [
    'fetch failed: Authorization: Bearer ' + fakeKey,
    '{"error":{"message":"invalid ' + fakeKey + '"}}',
    'getaddrinfo ENOTFOUND vendor.example at TCPConnectWrap.afterConnect',
    '<html>502 Bad Gateway</html>'
  ];
  for (const raw of leaks) {
    const text = describeAgentError(raw, '学习计划读取失败，请刷新重试。');
    assert.equal(text, '学习计划读取失败，请刷新重试。', raw);
    assert.doesNotMatch(text, /sk-|Bearer|Authorization|getaddrinfo|html/i, raw);
  }
  // 已知错误码的补充说明若含凭据字样，也只返回固定文案。
  const withDetail = describeAgentError('MODEL_HTTP: 请求失败，token=' + fakeKey);
  assert.doesNotMatch(withDetail, /sk-|token|=/);
  assert.match(withDetail, /模型服务暂时不可用/);
});

test('应用自身生成的中文补充说明会被保留', () => {
  const text = describeAgentError('MODEL_HTTP: 模型账户余额不足，请在服务商控制台充值后重试（HTTP 402）。');
  assert.match(text, /余额不足/);
  assert.match(text, /HTTP 402/);
  assert.doesNotMatch(text, /^MODEL_/);
  const long = describeAgentError('CALENDAR_INPUT: ' + '很'.repeat(200));
  assert.doesNotMatch(long, /很{120,}/);
});

test('错误码提取与「检查模型设置」提示只针对模型类失败', () => {
  assert.equal(errorCodeOf('MODEL_TIMEOUT: 模型请求超时，请检查网络后重试。'), 'MODEL_TIMEOUT');
  assert.equal(errorCodeOf('STORAGE_CORRUPT: 会话文件损坏'), 'STORAGE_CORRUPT');
  assert.equal(errorCodeOf('设备抛出的未分类异常'), '');
  assert.equal(errorCodeOf(''), '');
  for (const code of ['MODEL_CONFIG', 'MODEL_AUTH', 'MODEL_TIMEOUT', 'MODEL_TRANSPORT',
    'MODEL_RATE_LIMIT', 'MODEL_HTTP', 'MODEL_RESPONSE']) {
    assert.equal(needsModelSettings(code), true, code);
  }
  for (const code of ['STORAGE_CORRUPT', 'SPEECH_NO_RESULT', 'CALENDAR_PERMISSION', '']) {
    assert.equal(needsModelSettings(code), false, code);
  }
});

test('源码中登记的每个错误码都有对应的界面文案', async () => {
  async function collect(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await collect(full));
      else if (/\.(ts|ets)$/.test(entry.name)) files.push(full);
    }
    return files;
  }
  const root = path.join(workspace, 'app', 'entry', 'src', 'main', 'ets');
  const codes = new Set();
  for (const file of await collect(root)) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/['"]([A-Z][A-Z_]{2,}):\s/g)) codes.add(match[1]);
  }
  assert.ok(codes.size > 20, `实际提取到 ${codes.size} 个错误码`);
  const fallbackText = describeAgentError('未分类异常');
  for (const code of codes) {
    assert.equal(errorCodeOf(code + ': probe'), code, `界面缺少 ${code} 的文案`);
    assert.notEqual(describeAgentError(code + ': probe'), fallbackText, `界面把 ${code} 落到了通用兜底`);
  }
});

test('断网时用户输入已落盘，界面得到可读提示且下一轮可恢复', async () => {
  const store = new MemoryKeyValueStore();
  const sessions = new JsonSessionRepository(store);
  const registry = new ToolRegistry();
  const offline = new CompatibleModelClient(
    { post: async () => { throw new Error('getaddrinfo ENOTFOUND model.example'); } }, settings);
  const agent = new AgentEngine(offline, registry, sessions);
  const session = await agent.createConversation();
  const failed = await agent.send(session.id, '请帮我制定复习计划');
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /MODEL_TRANSPORT/);
  const uiText = describeAgentError(failed.error);
  assert.match(uiText, /无法连接模型服务/);
  assert.doesNotMatch(uiText, /MODEL_|ENOTFOUND|getaddrinfo/);
  assert.equal(needsModelSettings(errorCodeOf(failed.error)), true);
  const saved = await sessions.get(session.id);
  assert.equal(saved.messages.length, 1);
  assert.equal(saved.messages[0].content, '请帮我制定复习计划');
  const recovered = new AgentEngine(new MockModelClient(), registry, sessions);
  const next = await recovered.send(session.id, '继续');
  assert.equal(next.state, 'completed');
  assert.equal((await sessions.get(session.id)).messages.length, 3);
});

test('设备数据损坏时界面提示备份而非覆盖，原文件保持不变', async () => {
  const raw = '{"version":1,"conversations":[{"id":"x"';
  const store = new MemoryKeyValueStore();
  await store.set('sessions_v1', raw);
  const sessions = new JsonSessionRepository(store);
  let rawError = '';
  try { await sessions.list(); } catch (error) { rawError = error.message; }
  assert.match(rawError, /STORAGE_CORRUPT/);
  const uiText = describeAgentError(rawError);
  assert.match(uiText, /备份|保留原始/);
  assert.doesNotMatch(uiText, /STORAGE_CORRUPT/);
  assert.equal(needsModelSettings(errorCodeOf(rawError)), false);
  assert.equal(await store.get('sessions_v1'), raw);
});
