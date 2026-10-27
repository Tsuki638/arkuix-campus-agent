// 四人的公共边界。修改字段前先同步另外三位成员，并更新 docs/接口约定.md。
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type AgentState = 'idle' | 'thinking' | 'using_tool' | 'completed' | 'failed';

export interface ToolCall {
  id: string;
  name: string;
  input: string; // JSON 字符串；由工具自行校验，不能直接信任模型输出。
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  toolCalls: ToolCall[];
  toolCallId: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parametersJson: string; // 标准 JSON Schema，隔离模型厂商的字段差异。
}

export interface ToolResult {
  name: string;
  success: boolean;
  content: string;
}

export interface ModelReply {
  content: string;
  toolCalls: ToolCall[];
}

export interface AgentResult {
  conversation: Conversation;
  reply: string;
  state: AgentState;
  error: string;
}

export interface ModelSettings {
  endpoint: string; // 完整 HTTPS /chat/completions URL
  model: string;
  apiKey: string; // 仅运行时注入，禁止写入历史和提交仓库。
}

export interface JsonRequest {
  url: string;
  body: string;
  bearerToken: string;
}

let sequence: number = 0;

export function newId(prefix: string): string {
  sequence += 1;
  return prefix + '-' + Date.now().toString(36) + '-' + sequence.toString(36) +
    '-' + Math.random().toString(36).slice(2, 8);
}

export function makeMessage(role: MessageRole, content: string): ChatMessage {
  return {
    id: newId('message'), role: role, content: content, createdAt: Date.now(),
    toolCalls: [], toolCallId: ''
  };
}
