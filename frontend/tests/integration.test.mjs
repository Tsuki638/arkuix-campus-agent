import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCore } from '../../scripts/compile-core.mjs';
import { MockModelClient } from './support/MockModelClient.mjs';

const core = await compileCore();
const { createRuntime } = await core.load('bootstrap/Runtime.ts');
const { CompatibleModelClient } = await core.load('services/model/CompatibleModelClient.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { StudyDataRepository } = await core.load('services/storage/StudyDataRepository.ts');
const { UnavailableSpeechService } = await core.load('platform/speech/UnavailableSpeechService.ts');
const { DeepSeekConfig } = await core.load('services/model/DeepSeekConfig.ts');
const { ModelPresets, resolveModelSettings } = await core.load('services/model/ModelPresets.ts');
const { makeMessage } = await core.load('contracts/Models.ts');

function longCalendarTurn(topic) {
  const call = makeMessage('assistant', '');
  call.toolCalls = [{ id: 'calendar-' + call.id, name: 'list_calendar_drafts', input: '{}' }];
  const result = makeMessage('tool', '旧日程明细'.repeat(2100));
  result.toolCallId = call.toolCalls[0].id;
  return [makeMessage('user', topic), call, result, makeMessage('assistant', '这批草案已列出。')];
}

test('长会话滚动合并摘要，保留最近原话和历史，重启后采用已更正的条件', async () => {
  const initial = '周三晚上没空';
  const correction = '周三改为 20:00 后有空';
  const firstFollowup = '回想一下我周三有没有空？';
  const requests = [];
  const store = new MemoryKeyValueStore();
  const client = new CompatibleModelClient({ post: async ({ body }) => {
    const payload = JSON.parse(body);
    requests.push(payload);
    const input = payload.messages.at(-1).content;
    let content = '按你的周三时间约束安排。';
    if (payload.messages[0].content.includes('你负责更新学习规划助手的旧对话摘要')) {
      assert.equal(payload.tools, undefined);
      assert.doesNotMatch(input, /旧日程明细/);
      content = input.includes(correction) ? correction : initial;
    }
    return JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
  } }, { endpoint: 'https://example.invalid/chat/completions', model: 'test', apiKey: 'test-only' });
  const runtime = createRuntime(client, store, new UnavailableSpeechService(), 'test');
  const session = await runtime.agent.createConversation();
  const first = makeMessage('user', initial);
  const reply = makeMessage('assistant', '已记住。');
  session.messages.push(first, reply, ...longCalendarTurn('查看数学日程'), ...longCalendarTurn('查看英语日程'));
  await runtime.sessions.save(session);

  assert.equal((await runtime.agent.send(session.id, firstFollowup)).state, 'completed');
  const [firstSummaryRequest, firstAnswerRequest] = requests;
  assert.match(firstSummaryRequest.messages.at(-1).content, /周三晚上没空/);
  assert.doesNotMatch(firstSummaryRequest.messages.at(-1).content, /查看数学日程|查看英语日程/);
  assert.equal(firstAnswerRequest.messages[1].content, '【旧对话摘要】\n' + initial);
  assert.ok(firstAnswerRequest.messages.some(message => message.content === '查看数学日程'));
  assert.ok(firstAnswerRequest.messages.some(message => message.content === '查看英语日程'));
  assert.equal(firstAnswerRequest.messages.at(-1).content, firstFollowup);
  assert.ok(!firstAnswerRequest.messages.some(message => message.content === initial));

  const reopened = createRuntime(client, store, new UnavailableSpeechService(), 'test');
  const persisted = await reopened.sessions.get(session.id);
  assert.deepEqual(persisted.summary, { text: initial, throughMessageId: reply.id });
  assert.equal(persisted.messages[0].id, first.id);
  assert.ok(!persisted.messages.some(message => message.content.startsWith('【旧对话摘要】')));
  const correctionReply = makeMessage('assistant', '按新时间安排。');
  persisted.messages.push(makeMessage('user', correction), correctionReply,
    ...longCalendarTurn('核对数学日程'), ...longCalendarTurn('核对英语日程'));
  await reopened.sessions.save(persisted);

  assert.equal((await reopened.agent.send(session.id, '现在按之前的条件排计划')).state, 'completed');
  const [nextSummaryRequest, nextAnswerRequest] = requests.slice(2);
  const newSummaryInput = nextSummaryRequest.messages.at(-1).content;
  assert.equal(newSummaryInput.split(initial).length - 1, 1);
  assert.match(newSummaryInput, /周三改为 20:00 后有空/);
  assert.equal(nextAnswerRequest.messages[1].content, '【旧对话摘要】\n' + correction);
  const updated = await reopened.sessions.get(session.id);
  assert.deepEqual(updated.summary, { text: correction, throughMessageId: correctionReply.id });
  assert.equal(updated.messages[0].content, initial);
});

test('摘要调用、输出或保存失败时保留旧摘要和压缩位置，当前消息仍可发送', async () => {
  for (const failure of ['request', 'output', 'save']) {
    const backing = new MemoryKeyValueStore();
    let rejectSummarySave = false;
    const store = { get: key => backing.get(key), set: async (key, value) => {
      if (rejectSummarySave) {
        rejectSummarySave = false;
        throw new Error('摘要写入失败');
      }
      await backing.set(key, value);
    } };
    const seen = [];
    const runtime = createRuntime({ complete: async (messages, tools) => {
      if (tools.length === 0) {
        seen.push('summary');
        if (failure === 'request') throw new Error('摘要请求超时');
        if (failure === 'output') return { content: '超长'.repeat(2000), toolCalls: [] };
        rejectSummarySave = true;
        return { content: '新的摘要', toolCalls: [] };
      }
      seen.push(messages[1].content);
      assert.equal(messages.at(-1).content, '继续');
      return { content: '已继续。', toolCalls: [] };
    } }, store, new UnavailableSpeechService(), 'test');
    const session = await runtime.agent.createConversation();
    const anchor = makeMessage('assistant', '记住这个条件。');
    session.messages.push(makeMessage('user', '旧条件'), anchor, ...longCalendarTurn('已结束的日程'),
      ...longCalendarTurn('较新的日程'), ...longCalendarTurn('最新一批日程'));
    const previous = { text: '先前的摘要', throughMessageId: anchor.id };
    session.summary = previous;
    await runtime.sessions.save(session);

    assert.equal((await runtime.agent.send(session.id, '继续')).reply, '已继续。');
    assert.deepEqual(seen, ['summary', '【旧对话摘要】\n先前的摘要']);
    assert.deepEqual((await runtime.sessions.get(session.id)).summary, previous);
  }
});

test('模型预设默认 DeepSeek；默认密钥只绑定原接口，切换服务商不沿用密钥', () => {
  const defaults = { endpoint: DeepSeekConfig.endpoint, model: DeepSeekConfig.model, apiKey: 'default-test-key' };
  assert.equal(ModelPresets.providers[0].endpoint, defaults.endpoint);
  assert.equal(ModelPresets.providers[0].models[0].id, defaults.model);
  assert.equal(ModelPresets.providerIndex(defaults.endpoint, defaults.model), 0);
  assert.equal(resolveModelSettings({ ...defaults, apiKey: '' }, defaults).apiKey, 'default-test-key');
  assert.equal(resolveModelSettings({ ...defaults, apiKey: 'replacement-test-key' }, defaults).apiKey, 'replacement-test-key');
  for (const provider of ModelPresets.providers.slice(1)) {
    const settings = resolveModelSettings({ endpoint: provider.endpoint, model: 'example', apiKey: '' }, defaults);
    assert.equal(settings.apiKey, '');
  }
  assert.equal(resolveModelSettings({ endpoint: 'https://api.deepseek.com.evil.invalid/chat/completions',
    model: defaults.model, apiKey: '' }, defaults).apiKey, '');
  assert.equal(ModelPresets.providers[ModelPresets.providerIndex('https://example.invalid/chat/completions', 'custom')].id, 'custom');
});

test('预设模型按官方主机使用兼容参数，相似域名不注入供应商参数', async () => {
  for (const provider of ModelPresets.providers.filter(provider => provider.id !== 'custom')) {
    for (const model of provider.models) {
      let sent;
      const client = new CompatibleModelClient({ post: async request => {
        sent = JSON.parse(request.body);
        return JSON.stringify({ choices: [{ message: { role: 'assistant', content: '连接正常' } }] });
      } }, { endpoint: provider.endpoint, model: model.id, apiKey: 'test-only' });
      await client.complete([], []);
      if (provider.id === 'deepseek') assert.equal(sent.thinking.type, 'disabled');
      if (provider.id === 'qwen') assert.equal(sent.enable_thinking, false);
      if (provider.id === 'kimi' || provider.id === 'glm') assert.equal(sent.reasoning_effort, 'low');
      if (provider.id === 'glm') assert.equal(sent.thinking.type, 'enabled');
      if (provider.id === 'openai') assert.equal(sent.reasoning_effort, 'none');
      assert.equal(sent.model, model.id);
    }
  }
  for (const host of ['dashscope.aliyuncs.com', 'api.moonshot.cn', 'open.bigmodel.cn', 'api.openai.com']) {
    const client = new CompatibleModelClient({ post: async request => {
      const sent = JSON.parse(request.body);
      assert.equal(sent.thinking, undefined);
      assert.equal(sent.enable_thinking, undefined);
      assert.equal(sent.reasoning_effort, undefined);
      return JSON.stringify({ choices: [{ message: { role: 'assistant', content: '自定义接口' } }] });
    } }, { endpoint: `https://${host}.evil.invalid/chat/completions`, model: 'gpt-6-luna', apiKey: 'test-only' });
    await client.complete([], []);
  }
});

test('Kimi/GLM 工具调用保留推理字段，重建仓库可恢复，切换型号不传出旧字段', async () => {
  for (const providerId of ['kimi', 'glm']) {
    const provider = ModelPresets.providers.find(provider => provider.id === providerId);
    const settings = { endpoint: provider.endpoint, model: provider.models[0].id, apiKey: 'test-only-key' };
    const requests = [];
    const transport = { post: async request => {
      const payload = JSON.parse(request.body);
      requests.push(payload);
      if (requests.length === 1) {
        return JSON.stringify({ choices: [{ message: { role: 'assistant', content: null,
          reasoning_content: 'provider-specific-test-reasoning', tool_calls: [{ id: 'reasoning-plan', type: 'function',
            function: { name: 'create_study_plan', arguments: '{"goal":"英语复习","days":2}' } }] } }] });
      }
      assert.equal(payload.messages.find(message => message.tool_calls?.length).reasoning_content,
        'provider-specific-test-reasoning');
      return JSON.stringify({ choices: [{ message: { role: 'assistant', content: '计划已保存。' } }] });
    } };
    const store = new MemoryKeyValueStore();
    const runtime = createRuntime(new CompatibleModelClient(transport, settings), store,
      new UnavailableSpeechService(), settings.model);
    const session = await runtime.agent.createConversation();
    assert.equal((await runtime.agent.send(session.id, '请制定英语两天复习计划')).state, 'completed');
    assert.equal(requests.length, 2);
    const reopened = createRuntime(new CompatibleModelClient(transport, settings), store,
      new UnavailableSpeechService(), settings.model);
    assert.equal((await reopened.agent.send(session.id, '刚才的计划是什么？')).state, 'completed');
    const saved = await reopened.sessions.get(session.id);
    assert.equal(saved.messages.find(message => message.toolCalls.length).reasoningContent, 'provider-specific-test-reasoning');
    assert.equal((await store.get('sessions_v1')).includes(settings.apiKey), false);
    const switched = new CompatibleModelClient({ post: async request => {
      const sent = JSON.parse(request.body);
      assert.equal(sent.messages.find(message => message.tool_calls?.length).reasoning_content, '');
      assert.equal(request.body.includes('provider-specific-test-reasoning'), false);
      return JSON.stringify({ choices: [{ message: { role: 'assistant', content: '已切换' } }] });
    } }, { ...settings, model: 'another-model' });
    await switched.complete(saved.messages, []);
  }
});

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
