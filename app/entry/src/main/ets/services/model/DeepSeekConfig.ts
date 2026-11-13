// 2026-11-11 按 DeepSeek 官方文档确认；密钥只由运行时提供。
export class DeepSeekConfig {
  static readonly endpoint: string = 'https://api.deepseek.com/chat/completions';
  static readonly model: string = 'deepseek-flash';
  static readonly maxOutputTokens: number = 2048;
}

export function isOfficialDeepSeekEndpoint(endpoint: string): boolean {
  // 仅匹配官方主机，避免把供应商参数注入通用接口或相似域名。
  return /^https:\/\/api\.deepseek\.com(?:\/|$)/i.test(endpoint);
}
