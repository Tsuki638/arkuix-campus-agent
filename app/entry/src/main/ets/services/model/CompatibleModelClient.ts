import type { JsonTransport, ModelClient } from '../../contracts/Ports';
import type { ChatMessage, JsonRequest, ModelReply, ModelSettings, ToolCall, ToolDefinition } from '../../contracts/Models';

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

  constructor(transport: JsonTransport, settings: ModelSettings) {
    if (!/^https:\/\/[^\s]+$/.test(settings.endpoint) || settings.model.trim().length === 0 ||
      settings.apiKey.trim().length === 0) {
      throw new Error('MODEL_CONFIG: 请提供 HTTPS 接口、模型名称和运行时密钥。');
    }
    this.transport = transport;
    this.settings = settings;
  }

  async complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelReply> {
    const payload: WireRequest = {
      model: this.settings.model,
      messages: messages.map((message: ChatMessage): WireMessage => {
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
    const raw: string = await this.transport.post(request);
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
