// 界面错误文案统一入口（成员 C，对应 GitHub #6 / #7）。
// 底层保留 MODEL_* / STORAGE_* / CALENDAR_* 等错误码用于日志与自动检查，
// 界面只在显示前调用本模块：去掉英文码前缀、给出可操作的下一步，
// 并且绝不把未分类的原始异常（可能含供应商响应体、请求头或运行时密钥）透传到页面。

const FRIENDLY_TEXT: string[][] = [
  // 模型侧：文案必须说明「还能怎么继续」，对应 #6 断网 / 无效密钥 / 超时验收。
  ['MODEL_CONFIG', '模型配置不完整，请在「模型设置」补全 HTTPS 接口、模型名称和密钥；也可切回离线示例继续使用。'],
  ['MODEL_AUTH', '模型鉴权失败，密钥可能无效或已过期。请到「模型设置」重新填写，或切回离线示例继续。'],
  ['MODEL_RATE_LIMIT', '模型服务繁忙，请稍等片刻后重新发送；刚才的输入仍保留。'],
  ['MODEL_TIMEOUT', '模型请求超时，请检查网络后重新发送；刚才的输入仍保留，也可切回离线示例。'],
  ['MODEL_HTTP', '模型服务暂时不可用，请稍后重试或检查「模型设置」。'],
  ['MODEL_TRANSPORT', '无法连接模型服务，请检查网络与网络权限后重试；离线计划与历史仍可查看。'],
  ['MODEL_RESPONSE', '模型返回的内容无法识别，请确认所选模型支持工具调用，或换一个模型重试。'],
  // 存储侧：明确「不覆盖原始数据」，对应 #7 损坏保护与失败反馈。
  ['STORAGE_CORRUPT', '本地数据读取失败，已保留原始文件避免覆盖。请先备份应用数据，再联系团队处理；不要继续写入。'],
  ['STORAGE_KEY', '本地存储键非法，本次未写入。请重试或重新打开应用。'],
  ['CALENDAR_STORAGE', '日程记录读取失败，已保留原始数据。请刷新重试，不要重复确认。'],
  // 会话、计划、Agent。
  ['SESSION_NOT_FOUND', '这段会话已不存在，请新建会话后重试。'],
  ['SESSION_BUSY', '当前对话还在处理中，请等本轮结束再发送。'],
  ['STUDY_NOT_FOUND', '找不到对应的学习计划或任务，请刷新计划页或重新生成。'],
  ['EMPTY_INPUT', '请输入内容后再发送。'],
  ['EMPTY_MODEL_REPLY', '模型本轮没有返回内容，请换个说法重试。'],
  ['INVALID_INPUT', '输入的参数不符合要求，请修改后重试。'],
  ['TOO_MANY_TOOLS', '本轮工具请求过多，请缩小任务后继续。'],
  ['TOOL_FAILED', '工具执行失败，结果已如实交回模型；请按提示补充信息后继续。'],
  ['UNKNOWN_TOOL', '模型请求了未注册的工具，本轮未完成，请重试。'],
  ['DUPLICATE_TOOL', '工具重复注册，请检查应用配置。'],
  ['STEP_LIMIT', '已达到本轮执行上限，请缩小任务后分几次继续。'],
  ['AGENT_FAILED', '本轮未能完成，请稍后重试；历史记录不受影响。'],
  // 构造期配置错误：正常不会到界面，登记后保证错误码完备性检查不漏项。
  ['INVALID_STEPS', '应用内部配置有误，本轮未执行；请更新应用后重试。'],
  // 语音：拒绝授权后必须能继续文本路径。
  ['SPEECH_UNAVAILABLE', '当前设备不支持或未开启语音，可以直接继续用文字对话。'],
  ['SPEECH_PERMISSION_DENIED', '未获得麦克风权限。可在系统设置中授权，或直接继续用文字输入。'],
  ['SPEECH_NO_RESULT', '没有识别到清晰语音，请重试或改用文字输入。'],
  ['SPEECH_TIMEOUT', '语音操作超时，请重试或使用文字输入。'],
  ['SPEECH_BUSY', '语音正在使用中，请先停止当前操作。'],
  ['SPEECH_CANCELLED', '已停止语音，可以继续文字对话。'],
  ['SPEECH_TEXT_TOO_LONG', '本次回复太长，无法一次播报，请直接阅读文字。'],
  ['SPEECH_ASR_FAILED', '语音识别失败，请重试或改用文字输入。'],
  ['SPEECH_TTS_FAILED', '语音播报失败，文字回复仍可正常阅读。'],
  // 日历：草案与已写入系统日程的状态要说明清楚。
  ['CALENDAR_UNAVAILABLE', '当前平台暂不支持写入系统日历，应用内日程草案仍可查看。'],
  ['CALENDAR_PERMISSION', '未获得日历权限，草案已保留。可在系统设置授权后回到预览页重试。'],
  ['CALENDAR_INPUT', '日程参数不符合要求，请修改后重试；草案已保留。'],
  ['CALENDAR_NOT_FOUND', '找不到这条日程记录，请刷新预览页。'],
  ['CALENDAR_STALE', '这份草案已变化，请刷新预览后重新确认。'],
  ['CALENDAR_LOCKED', '该日程已完成或已写入，不能在此修改；已创建的日程不会被草案取消删除。'],
  ['CALENDAR_DUPLICATE', '这些任务已有日程草案，请到预览页查看，避免重复创建。'],
  ['CALENDAR_CANCELLED', '草案已取消，已创建的系统日程继续保留。'],
  ['CALENDAR_CONTEXT', '缺少当前会话，请回到对话页后重新准备日程。']
];

// 这些错误码的冒号后是应用自身生成的中文补充说明（例如余额不足、系统错误码）。
// 仅在通过安全检查后追加，且限制长度，避免把供应商响应体或凭据带进界面。
const DETAIL_CODES: string[] = ['MODEL_HTTP', 'CALENDAR_INPUT', 'CALENDAR_PERMISSION',
  'SPEECH_UNAVAILABLE', 'SPEECH_ASR_FAILED', 'SPEECH_TTS_FAILED', 'CALENDAR_UNAVAILABLE'];

// 出现这些字样时，说明文本可能来自外部响应或包含凭据，一律不追加。
function looksUnsafe(text: string): boolean {
  const lower: string = text.toLowerCase();
  return lower.includes('sk-') || lower.includes('bearer') || lower.includes('authorization') ||
    lower.includes('api_key') || lower.includes('apikey') || lower.includes('token') ||
    lower.includes('<') || lower.includes('{') || lower.includes('http://') || lower.includes('https://');
}

export function errorCodeOf(message: string): string {
  const text: string = message === undefined || message === null ? '' : message;
  const colon: number = text.indexOf(':');
  if (colon <= 0) { return ''; }
  const code: string = text.slice(0, colon);
  for (const item of FRIENDLY_TEXT) {
    if (code === item[0]) { return code; }
  }
  return '';
}

// 用于界面决定是否提示用户去检查模型配置，而不必解析展示文案。
export function needsModelSettings(code: string): boolean {
  return code === 'MODEL_CONFIG' || code === 'MODEL_AUTH' || code === 'MODEL_TIMEOUT' ||
    code === 'MODEL_TRANSPORT' || code === 'MODEL_RATE_LIMIT' || code === 'MODEL_HTTP' ||
    code === 'MODEL_RESPONSE';
}

// fallback 为场景化兜底（如「学习计划读取失败」）。未知异常只返回 fallback，
// 不返回原始 message：设备 HTTP 端口或平台 API 的异常可能携带账户信息与密钥。
export function describeAgentError(message: string,
  fallback: string = '本轮未能完成，请稍后重试；可继续输入或检查网络与模型设置。'): string {
  const text: string = message === undefined || message === null ? '' : message.trim();
  if (text.length === 0) { return ''; }
  const code: string = errorCodeOf(text);
  if (code.length === 0) { return fallback; }
  let friendly: string = fallback;
  for (const item of FRIENDLY_TEXT) {
    if (item[0] === code) { friendly = item[1]; break; }
  }
  let showDetail: boolean = false;
  for (const item of DETAIL_CODES) {
    if (item === code) { showDetail = true; break; }
  }
  if (!showDetail) { return friendly; }
  const detail: string = text.slice(code.length + 1).trim();
  if (detail.length === 0 || detail.length > 120 || looksUnsafe(detail)) { return friendly; }
  return friendly + '（' + detail + '）';
}
