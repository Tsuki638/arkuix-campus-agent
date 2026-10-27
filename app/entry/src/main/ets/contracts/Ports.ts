import type { AgentResult, AgentState, ChatMessage, Conversation, JsonRequest,
  ModelReply, ToolDefinition, ToolResult } from './Models';

export interface ModelClient {
  complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelReply>;
}

export interface AgentTool {
  definition(): ToolDefinition;
  execute(input: string): Promise<ToolResult>;
}

export interface SessionRepository {
  list(): Promise<Conversation[]>;
  get(id: string): Promise<Conversation | null>;
  save(conversation: Conversation): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface KeyValueStore {
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<void>;
}

export interface JsonTransport {
  post(request: JsonRequest): Promise<string>;
}

export interface SpeechService {
  isAvailable(): boolean;
  recognizeOnce(): Promise<string>;
  speak(text: string): Promise<void>;
  stop(): Promise<void>;
}

export type StateListener = (state: AgentState) => void;

export interface AgentService {
  createConversation(): Promise<Conversation>;
  send(conversationId: string, text: string, onState?: StateListener): Promise<AgentResult>;
}
