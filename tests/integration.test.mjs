import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCore } from '../scripts/compile-core.mjs';

const core = await compileCore();
const { createRuntime } = await core.load('bootstrap/Runtime.ts');
const { CompatibleModelClient } = await core.load('services/model/CompatibleModelClient.ts');
const { MockModelClient } = await core.load('services/model/MockModelClient.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { StudyDataRepository } = await core.load('services/storage/StudyDataRepository.ts');
const { UnavailableSpeechService } = await core.load('platform/speech/UnavailableSpeechService.ts');
const { DeepSeekConfig } = await core.load('services/model/DeepSeekConfig.ts');

test('DeepSeek 非思考模式完成工具往返及第二轮对话，通用接口不携带供应商参数', async () => {
  const store = new MemoryKeyValueStore();
  const requests = [];
  const transport = { post: async (request) => {
    const payload = JSON.parse(request.body);
    requests.push(payload);
    assert.equal(payload.thinking.type, 'disabled');
    assert.equal(payload.max_tokens, 2048);
    if (requests.length === 1) {
      return JSON.stringify({ choices: [{ message: { role: 'assistant', content: null,
        tool_calls: [{ id: 'deepseek-plan', type: 'function', function: {
          name: 'create_study_plan', arguments: '{"goal":"复习高数","days":3}'
        } }] } }] });
    }
    const toolResult = payload.messages.find((message) => message.role === 'tool');
    assert.equal(toolResult.tool_call_id, 'deepseek-plan');
    assert.equal(JSON.parse(toolResult.content).success, true);
    assert.equal(payload.messages.filter((message) => message.tool_calls?.length).length, 1);
    if (requests.length === 3) {
      assert.equal(payload.messages.filter((message) => message.role === 'user').length, 2);
      assert.equal(payload.messages.at(-1).content, '刚才是什么计划？');
    }
    return JSON.stringify({ choices: [{ message: { role: 'assistant', content: '高数复习计划，共 3 天。' } }] });
  } };
  const client = new CompatibleModelClient(transport, {
    endpoint: DeepSeekConfig.endpoint, model: DeepSeekConfig.model, apiKey: 'test-secret-only'
  });
  const runtime = createRuntime(client, store, new UnavailableSpeechService(), 'DeepSeek 测试');
  const session = await runtime.agent.createConversation();
  assert.equal((await runtime.agent.send(session.id, '创建 3 天高数计划')).state, 'completed');
  assert.equal((await runtime.agent.send(session.id, '刚才是什么计划？')).state, 'completed');
  assert.equal(requests.length, 3);
  assert.equal((await runtime.study.listPlans())[0].tasks.length, 3);
  assert.equal((await store.get('sessions_v1')).includes('test-secret-only'), false);

  for (const endpoint of ['https://example.invalid/chat/completions',
    'https://api.deepseek.com.example.invalid/chat/completions']) {
    const generic = new CompatibleModelClient({ post: async (request) => {
      const payload = JSON.parse(request.body);
      assert.equal(payload.thinking, undefined);
      assert.equal(payload.max_tokens, undefined);
      return JSON.stringify({ choices: [{ message: { role: 'assistant', content: '通用接口正常' } }] });
    } }, { endpoint, model: 'generic', apiKey: 'test-only' });
    await generic.complete([], []);
  }
});

test('识别文本经模型适配器调用工具、回传结果，计划与打卡可跨运行时恢复', async () => {
  const store = new MemoryKeyValueStore();
  const requests = [];
  const settings = { endpoint: 'https://example.invalid/v1/chat/completions',
    model: 'integration-test', apiKey: 'integration-test-only' };
  const transport = { post: async (request) => {
    requests.push(JSON.parse(request.body));
    if (requests.length === 1) {
      return JSON.stringify({ choices: [{ message: { role: 'assistant', content: null,
        tool_calls: [{ id: 'plan-call', type: 'function', function: {
          name: 'create_study_plan', arguments: '{"goal":"复习高数","days":3}'
        } }] } }] });
    }
    const tool = requests[1].messages.at(-1);
    assert.equal(tool.role, 'tool');
    assert.equal(tool.tool_call_id, 'plan-call');
    assert.equal(JSON.parse(tool.content).success, true);
    return JSON.stringify({ choices: [{ message: { role: 'assistant', content: '计划已保存，可在学习计划中查看。' } }] });
  } };
  let spoken = '';
  const speech = { isAvailable: () => true,
    recognizeOnce: async () => '请给我制定三天的高数计划',
    speak: async (text) => { spoken = text; }, stop: async () => {} };
  const runtime = createRuntime(new CompatibleModelClient(transport, settings), store, speech, '测试云模型');
  const conversation = await runtime.agent.createConversation();
  const result = await runtime.agent.send(conversation.id, await runtime.speech.recognizeOnce());
  assert.equal(result.state, 'completed');
  assert.equal(requests.length, 2);
  await runtime.speech.speak(result.reply);
  assert.equal(spoken, result.reply);
  const [plan] = await runtime.study.listPlans();
  assert.equal(plan.conditions.goal, '复习高数');
  assert.equal(plan.tasks.length, 3);
  await runtime.study.setTaskCompletion(plan.id, plan.tasks[0].id, true);
  await runtime.study.setTaskCompletion(plan.id, plan.tasks[0].id, true);
  const reopened = createRuntime(new MockModelClient(), store, speech, '离线');
  assert.equal((await reopened.study.getPlan(plan.id)).tasks[0].status, 'done');
  assert.equal((await reopened.study.listRecords(plan.id)).length, 1);
  assert.equal((await reopened.sessions.get(conversation.id)).messages.length, 4);
  assert.equal((await store.get('sessions_v1')).includes(settings.apiKey), false);
  assert.equal((await store.get('study_data_v1')).includes(settings.apiKey), false);
});

test('切换模型保留同一份会话、学习数据与语音，并继续使用旧上下文', async () => {
  const runtime = createRuntime(new MockModelClient(), new MemoryKeyValueStore(),
    new UnavailableSpeechService(), '离线');
  const session = await runtime.agent.createConversation();
  await runtime.agent.send(session.id, '高数|2');
  const beforeSessions = runtime.sessions;
  const beforeStudy = runtime.study;
  const beforeSpeech = runtime.speech;
  runtime.replaceModel({ complete: async (messages) => {
    assert.ok(messages.some((message) => message.role === 'tool'));
    assert.ok(messages.some((message) => message.role === 'user' && message.content === '高数|2'));
    return { content: '已沿用之前的学习计划', toolCalls: [] };
  } }, '云端');
  assert.equal((await runtime.agent.send(session.id, '继续')).state, 'completed');
  assert.equal(runtime.sessions, beforeSessions);
  assert.equal(runtime.study, beforeStudy);
  assert.equal(runtime.speech, beforeSpeech);
  assert.equal((await runtime.study.listPlans()).length, 1);
});

test('学习数据损坏时工具明确失败，保留原数据和会话可用性', async () => {
  const store = new MemoryKeyValueStore();
  await store.set('study_data_v1', '{broken');
  const runtime = createRuntime(new MockModelClient(), store, new UnavailableSpeechService(), '离线');
  const conversation = await runtime.agent.createConversation();
  const result = await runtime.agent.send(conversation.id, '高数|2');
  const toolResult = JSON.parse(result.conversation.messages.find((message) => message.role === 'tool').content);
  assert.equal(toolResult.success, false);
  assert.match(result.reply, /工具未完成/);
  assert.equal(await store.get('study_data_v1'), '{broken');
  assert.equal((await runtime.sessions.list()).length, 1);
});

test('打卡写入失败不留下半更新；恢复后可重试且撤销状态可恢复', async () => {
  const backing = new MemoryKeyValueStore();
  let fail = false;
  const store = { get: (key) => backing.get(key), set: async (key, value) => {
    if (fail) throw new Error('disk full');
    await backing.set(key, value);
  } };
  const study = new StudyDataRepository(store);
  await study.addPlan({ id: 'p', createdAt: 1,
    conditions: { goal: '高数', dailyMinutes: 0, startDate: '' },
    tasks: [{ id: 't', title: '练习', day: 1, status: 'pending' }] });
  fail = true;
  await assert.rejects(study.setTaskCompletion('p', 't', true), /disk full/);
  assert.equal((await study.getPlan('p')).tasks[0].status, 'pending');
  assert.equal((await study.listRecords('p')).length, 0);
  fail = false;
  await study.setTaskCompletion('p', 't', true);
  await study.setTaskCompletion('p', 't', false);
  assert.equal((await new StudyDataRepository(store).getPlan('p')).tasks[0].status, 'pending');
  assert.equal((await study.listRecords('p')).length, 1);
});
