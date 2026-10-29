import type { JsonTransport, ModelClient } from '../../contracts/Ports';
import type { ChatMessage, JsonRequest, ModelReply, ModelSettings, ToolCall, ToolDefinition } from '../../contracts/Models';
import { DEFAULT_MAX_CONTEXT_CHARS, trimContext } from './ContextTrimmer';

export interface ModelClientOptions {
  // 送入模型的上下文预算（字符），超过后按工具分组丢弃最早历史。
  maxContextChars?: number;
}

// 把传输层与模型返回的原始异常收敛为固定的 MODEL_* 错误码，
// 既保留成员 D 在 OhosJsonTransport 里已抛出的分类，也覆盖断网/超时等未分类情况。
// 只输出面向用户的中文说明，绝不透传供应商响应或密钥。
const KNOWN_CODES: string[] = ['MODEL_CONFIG', 'MODEL_AUTH', 'MODEL_RATE_LIMIT',
  'MODEL_TIMEOUT', 'MODEL_HTTP', 'MODEL_TRANSPORT', 'MODEL_RESPONSE'];

function classifyTransportError(error: Error): Error {
  const message: string = error.message || '';
  for (const code of KNOWN_CODES) {
    if (message.startsWith(code + ':')) { return error; }
  }
  const lower: string = message.toLowerCase();
  if (/\b(401|403)\b/.test(message) || lower.includes('invalid_api_key') || lower.includes('unauthorized') ||
    lower.includes('forbidden')) {
    return new Error('MODEL_AUTH: 模型鉴权失败，请检查运行时密钥。');
  }
  if (/\b429\b/.test(message) || lower.includes('rate limit') || lower.includes('throttl') ||
    lower.includes('too many requests')) {
    return new Error('MODEL_RATE_LIMIT: 模型服务限流，请稍后重试。');
  }
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('aborted') ||
    lower.includes('abort') || message.includes('超时')) {
    return new Error('MODEL_TIMEOUT: 模型请求超时，请检查网络后重试。');
  }
  if (/http\s*\d{3}/i.test(message) || lower.includes('bad gateway') || lower.includes('service unavailable')) {
    return new Error('MODEL_HTTP: 模型请求失败，服务暂时不可用，请稍后重试。');
  }
  return new Error('MODEL_TRANSPORT: 无法连接模型服务，请检查网络后重试。');
}

interface WireFunctionCall { name: string; arguments: string; }
interface WireToolCall { id: string; type: string; function: WireFunctionCall; }
interface WireMessage {
  role: string;
  content: string | null;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
}
interface WireFunctionDefinition { name: string; description: string; parameters: Object; }
interface WireTool { type: string; function: WireFunctionDefinition; }
interface WireRequest {
  model: string;
  messages: WireMessage[];
  stream: boolean;
  tools?: WireTool[];
}
interface WireChoice { message: WireMessage; }
interface WireResponse { choices: WireChoice[]; }

// 使用常见的 Chat Completions / Function Calling 协议，不绑定模型厂商。
// 供应商专有参数（如思考开关）由成员 C 按选定模型文档扩展此适配层。
export class CompatibleModelClient implements ModelClient {
  private transport: JsonTransport;
  private settings: ModelSettings;
  private maxContextChars: number;

  constructor(transport: JsonTransport, settings: ModelSettings, options: ModelClientOptions = {}) {
    if (!/^https:\/\/[^\s]+$/.test(settings.endpoint) || settings.model.trim().length === 0 ||
      settings.apiKey.trim().length === 0) {
      throw new Error('MODEL_CONFIG: 请提供 HTTPS 接口、模型名称和运行时密钥。');
    }
    const budget: number = options.maxContextChars === undefined ? DEFAULT_MAX_CONTEXT_CHARS : options.maxContextChars;
    if (!Number.isInteger(budget) || budget < 1) {
      throw new Error('MODEL_CONFIG: 上下文预算必须是正整数。');
    }
    this.transport = transport;
    this.settings = settings;
    this.maxContextChars = budget;
  }

  async complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelReply> {
    const trimmed: ChatMessage[] = trimContext(messages, this.maxContextChars);
    const payload: WireRequest = {
      model: this.settings.model,
      messages: trimmed.map((message: ChatMessage): WireMessage => {
        const wire: WireMessage = { role: message.role, content: message.content };
        if (message.toolCalls.length > 0) {
          wire.tool_calls = message.toolCalls.map((call: ToolCall): WireToolCall => {
            return { id: call.id, type: 'function', function: { name: call.name, arguments: call.input } };
          });
        }
        if (message.role === 'tool') { wire.tool_call_id = message.toolCallId; }
        return wire;
      }),
      stream: false
    };
    if (tools.length > 0) {
      payload.tools = tools.map((tool: ToolDefinition): WireTool => {
        return { type: 'function', function: {
          name: tool.name, description: tool.description, parameters: JSON.parse(tool.parametersJson) as Object
        } };
      });
    }
    const request: JsonRequest = {
      url: this.settings.endpoint, body: JSON.stringify(payload), bearerToken: this.settings.apiKey
    };
    let raw: string;
    try {
      raw = await this.transport.post(request);
    } catch (error) {
      throw classifyTransportError(error as Error);
    }
    try {
      const response: WireResponse = JSON.parse(raw) as WireResponse;
      if (response === null || !Array.isArray(response.choices) || response.choices.length === 0 ||
        response.choices[0] === null) {
        throw new Error('Missing choice');
      }
      const message: WireMessage = response.choices[0].message;
      if (message === null || message === undefined || message.role !== 'assistant' ||
        (message.content !== null && message.content !== undefined && typeof message.content !== 'string') ||
        (message.tool_calls !== undefined && !Array.isArray(message.tool_calls))) {
        throw new Error('Invalid message');
      }
      const calls: ToolCall[] = [];
      const callIds: Set<string> = new Set<string>();
      if (message.tool_calls !== undefined) {
        for (const call of message.tool_calls) {
          if (call === null || call.type !== 'function' || typeof call.id !== 'string' || call.id.length === 0 ||
            callIds.has(call.id) || call.function === null || call.function === undefined ||
            typeof call.function.name !== 'string' || call.function.name.length === 0 ||
            typeof call.function.arguments !== 'string') {
            throw new Error('Invalid tool call');
          }
          callIds.add(call.id);
          calls.push({ id: call.id, name: call.function.name, input: call.function.arguments });
        }
      }
      if (calls.length === 0 && (!message.content || message.content.trim().length === 0)) {
        throw new Error('Empty reply');
      }
      return { content: message.content || '', toolCalls: calls };
    } catch {
      // 不向 UI 透传供应商响应全文，以免返回体含账户信息等数据。
      throw new Error('MODEL_RESPONSE: 模型响应为空或格式不兼容，请检查模型与工具调用支持。');
    }
  }
}
