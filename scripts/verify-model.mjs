import { compileCore } from './compile-core.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

// 成员 C 的真实模型连通性验证。设备端 OhosJsonTransport 是 .ets，无法在 Node 运行，
// 这里用 fetch 复刻同一个 JsonTransport 端口（同样的 Bearer 头、超时、状态码分类），
// 验证 CompatibleModelClient 的工具协议、多轮上下文和仓库序列化，不代替实机验收。
//
// 用法：设置环境变量后运行 `node scripts/verify-model.mjs`
//   MODEL_ENDPOINT  完整 HTTPS /chat/completions 地址
//   MODEL_MODEL     模型名称
//   MODEL_API_KEY   运行时密钥（只经 Authorization 头发送，禁止提交仓库）
// DeepSeek：npm run verify:deepseek，从被 Git 忽略的 .env.local 读取 DEEPSEEK_API_KEY。
// 缺少密钥或通用配置时以 2 退出，不会误报为已通过真实调用。

const deepseek = process.argv.includes('--deepseek');
const calendarMode = process.argv.includes('--calendar');
const apiKey = deepseek ? process.env.DEEPSEEK_API_KEY || '' : process.env.MODEL_API_KEY || '';

if (!apiKey || (!deepseek && (!process.env.MODEL_ENDPOINT || !process.env.MODEL_MODEL))) {
  console.log(deepseek ? '未执行真实验证：请在 .env.local 中设置 DEEPSEEK_API_KEY。' :
    '未执行真实验证：请提供 MODEL_ENDPOINT / MODEL_MODEL / MODEL_API_KEY。');
  process.exit(2);
}

const core = await compileCore();
const { DeepSeekConfig } = await core.load('services/model/DeepSeekConfig.ts');
const endpoint = deepseek ? DeepSeekConfig.endpoint : process.env.MODEL_ENDPOINT;
const model = deepseek ? process.env.DEEPSEEK_MODEL || DeepSeekConfig.model : process.env.MODEL_MODEL;
const { CompatibleModelClient } = await core.load('services/model/CompatibleModelClient.ts');
const { createRuntime } = await core.load('bootstrap/Runtime.ts');
const { MemoryKeyValueStore } = await core.load('services/storage/MemoryKeyValueStore.ts');
const { UnavailableSpeechService } = await core.load('platform/speech/UnavailableSpeechService.ts');

const requests = [];
const transport = {
  async post(request) {
    const payload = JSON.parse(request.body);
    requests.push({ model: payload.model, messageCount: payload.messages.length,
      carriesToolResult: payload.messages.some((message) => message.role === 'tool'),
      thinking: payload.thinking?.type || 'provider-default', status: null, usage: null });
    const record = requests.at(-1);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.bearerToken}` },
        body: request.body,
        signal: controller.signal
      });
      record.status = response.status;
      if (response.status === 401 || response.status === 403) {
        throw new Error('MODEL_AUTH: 模型鉴权失败，请检查运行时密钥。');
      }
      if (response.status === 429) {
        throw new Error('MODEL_RATE_LIMIT: 模型服务限流，请稍后重试。');
      }
      if (response.status === 402) {
        throw new Error('MODEL_HTTP: 模型账户余额不足，请在服务商控制台充值后重试（HTTP 402）。');
      }
      if (!response.ok) {
        throw new Error(`MODEL_HTTP: 模型请求失败，HTTP ${response.status}`);
      }
      const raw = await response.text();
      try {
        const usage = JSON.parse(raw).usage;
        if (usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)) {
          record.usage = { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens };
        }
      } catch { /* 由模型适配器分类响应解析错误。 */ }
      return raw;
    } finally {
      clearTimeout(timer);
    }
  }
};

const client = new CompatibleModelClient(transport, { endpoint, model, apiKey });
const store = new MemoryKeyValueStore();
const speech = new UnavailableSpeechService();
const runtime = createRuntime(client, store, speech, '真实模型验证');
const report = { provider: deepseek ? 'DeepSeek' : '兼容接口', model,
  verifiedAt: new Date().toISOString(), passed: false, requests,
  checks: { toolExecuted: false, planSaved: false, multiTurn: false, restoredFromSerializedData: false },
  firstReply: '', followUpReply: '', error: '' };
const safe = (value) => String(value).replaceAll(apiKey, '[REDACTED]');

async function verifyCalendarDrafts() {
  const { calendarTimeText } = await core.load('services/calendar/CalendarTime.ts');
  report.scope = '真实模型日程草案与查询；设备写入未验收';
  report.checks = { draftPrepared: false, queryReturnedActualState: false,
    noWriteBeforeConfirmation: false, restoredFromSerializedData: false };
  const date = calendarTimeText(Date.now() + 86400000).slice(0, 10);
  const session = await runtime.agent.createConversation();
  const result = await runtime.agent.send(session.id,
    `请调用 prepare_calendar_events，准备 ${date} 北京时间 19:00 到 20:00 的高数复习日程，提前 10 分钟提醒。` +
    '这是一条独立日程，先给我草案预览，不创建学习计划。');
  if (result.state !== 'completed') throw new Error(result.error);
  report.firstReply = safe(result.reply);
  const prepared = result.conversation.messages.filter((message) => message.role === 'tool')
    .map((message) => JSON.parse(message.content));
  const drafts = await runtime.calendar.list(session.id);
  report.checks.draftPrepared = prepared.some((tool) => tool.name === 'prepare_calendar_events' && tool.success) &&
    drafts.length === 1 && drafts[0].events.length === 1 && drafts[0].status === 'pending';
  if (!report.checks.draftPrepared) throw new Error('真实模型没有生成一份待确认的单条日程草案。');
  const event = drafts[0].events[0];
  if (calendarTimeText(event.startTime) !== `${date} 19:00` ||
      calendarTimeText(event.endTime) !== `${date} 20:00` || !event.reminderMinutes.includes(10)) {
    throw new Error('真实模型生成的日期、起止时间或提醒不符合要求。');
  }
  console.log('已通过：真实模型调用日历工具，保存明确日期、时段和提醒的待确认草案。');
  const followUp = await runtime.agent.send(session.id,
    '请调用 list_calendar_drafts 查询刚才日程的实际状态，明确告诉我是否已经写入系统日历，以及下一步如何确认。');
  if (followUp.state !== 'completed') throw new Error(followUp.error);
  report.followUpReply = safe(followUp.reply);
  const queried = followUp.conversation.messages.slice(result.conversation.messages.length)
    .filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content));
  report.checks.queryReturnedActualState = queried.some((tool) => tool.name === 'list_calendar_drafts' && tool.success &&
    JSON.parse(tool.content).some((draft) => draft.id === drafts[0].id && draft.status === 'pending'));
  report.checks.noWriteBeforeConfirmation = (await runtime.calendar.list(session.id)).every((draft) =>
    draft.events.every((item) => item.state === 'pending' && item.eventId === 0));
  if (!report.checks.queryReturnedActualState || !report.checks.noWriteBeforeConfirmation) {
    throw new Error('日程查询或待确认状态检查失败。');
  }
  const restoredStore = new MemoryKeyValueStore();
  for (const key of ['sessions_v1', 'calendar_data_v1']) {
    const value = await store.get(key);
    if (value.includes(apiKey)) throw new Error('检测到密钥进入持久化内容。');
    await restoredStore.set(key, value);
  }
  const reopened = createRuntime(client, restoredStore, speech, '恢复验证');
  report.checks.restoredFromSerializedData = (await reopened.calendar.list(session.id))[0]?.id === drafts[0].id;
  if (!report.checks.restoredFromSerializedData) throw new Error('日历草案序列化恢复失败。');
  report.passed = true;
  console.log(`日程草案验证通过，共 ${requests.length} 次真实 HTTP 请求；所有条目保持未写入状态。`);
  console.log('查询回复：' + report.followUpReply);
}

console.log(`正在使用 ${model} 验证${calendarMode ? '日程草案与查询' : '完整 Agent 工具'}流程……`);
try {
  if (calendarMode) {
    await verifyCalendarDrafts();
  } else {
  const session = await runtime.agent.createConversation();
  const result = await runtime.agent.send(session.id,
    '请调用 create_study_plan 工具，为复习高数制定 3 天的计划，执行后说明结果。');
  if (result.state !== 'completed') { throw new Error(result.error); }
  const results = result.conversation.messages.filter((message) => message.role === 'tool')
    .map((message) => JSON.parse(message.content));
  report.checks.toolExecuted = results.some((tool) => tool.name === 'create_study_plan' && tool.success);
  if (!report.checks.toolExecuted) {
    throw new Error('本次未完成学习计划工具调用，不能计为工具流程验收。');
  }
  const plans = await runtime.study.listPlans();
  report.checks.planSaved = plans.length === 1 && plans[0].tasks.length === 3 &&
    requests.some((request) => request.carriesToolResult);
  if (!report.checks.planSaved) throw new Error('计划未按预期保存为一份含 3 天任务的数据。');
  report.firstReply = safe(result.reply);
  console.log('已通过：真实模型选择工具 → 本地执行并保存 3 天计划 → 回传工具结果 → 最终答复。');

  const followUp = await runtime.agent.send(session.id,
    '不要创建新计划，也不要再次调用工具。只根据上文告诉我：刚刚保存的计划针对什么科目、持续几天？用一句中文回答。');
  if (followUp.state !== 'completed') throw new Error(followUp.error);
  report.followUpReply = safe(followUp.reply);
  const followUpCalls = followUp.conversation.messages.filter((message) => message.role === 'tool').length;
  report.checks.multiTurn = followUpCalls === results.length && /高数|高等数学/.test(followUp.reply) &&
    /3|三/.test(followUp.reply);
  if (!report.checks.multiTurn) throw new Error('第二轮未正确沿用计划上下文，或重复调用了工具。');
  console.log('已通过：第二轮记住计划科目和天数，未重复创建计划。');

  const restoredStore = new MemoryKeyValueStore();
  for (const key of ['sessions_v1', 'study_data_v1']) {
    const value = await store.get(key);
    if (value.includes(apiKey)) throw new Error('检测到密钥进入持久化内容。');
    await restoredStore.set(key, value);
  }
  const reopened = createRuntime(client, restoredStore, speech, '恢复验证');
  report.checks.restoredFromSerializedData = (await reopened.study.listPlans()).length === 1 &&
    (await reopened.sessions.get(session.id)).messages.length === followUp.conversation.messages.length;
  if (!report.checks.restoredFromSerializedData) throw new Error('会话或计划无法从仓库序列化数据恢复。');
  console.log('已通过：会话与计划从序列化数据恢复，数据中不含密钥。');
  report.passed = true;
  console.log(`真实验证通过，共 ${requests.length} 次 HTTP 请求。第二轮答复：${report.followUpReply}`);
  }
} catch (error) {
  report.error = safe(error.message || '验证失败');
  console.error('真实模型验证失败：', report.error);
  process.exitCode = 1;
} finally {
  await mkdir('.generated', { recursive: true });
  const reportPath = calendarMode ? '.generated/deepseek-calendar-verification.json' :
    deepseek ? '.generated/deepseek-verification.json' : '.generated/model-verification.json';
  await writeFile(reportPath, safe(JSON.stringify(report, null, 2)) + '\n', { mode: 0o600 });
  console.log(`已保存脱敏验证报告：${reportPath}（Node 共享逻辑验证，未包含设备端验收）。`);
}
