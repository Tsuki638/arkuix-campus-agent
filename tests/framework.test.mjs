import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { compileCore, workspace } from '../scripts/compile-core.mjs';

const core = await compileCore();
const { AgentEngine } = await core.load('agent/AgentEngine.ts');
const { ToolRegistry } = await core.load('agent/ToolRegistry.ts');
const { StudyPlanTool } = await core.load('agent/tools/StudyPlanTool.ts');
const { MockModelClient } = await core.load('services/model/MockModelClient.ts');
const { CompatibleModelClient } = await core.load('services/model/CompatibleModelClient.ts');
const { JsonSessionRepository } = await core.load('services/storage/JsonSessionRepository.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { createMockRuntime } = await core.load('bootstrap/Runtime.ts');
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
