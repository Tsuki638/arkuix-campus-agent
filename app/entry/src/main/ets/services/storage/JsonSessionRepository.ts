import type { KeyValueStore, SessionRepository } from '../../contracts/Ports';
import type { ChatMessage, Conversation, ToolCall } from '../../contracts/Models';

interface SessionDocument { version: number; conversations: Conversation[]; }

export class JsonSessionRepository implements SessionRepository {
  private store: KeyValueStore;
  private pending: Promise<void> = Promise.resolve();
  private key: string = 'sessions_v1';

  constructor(store: KeyValueStore) { this.store = store; }

  async list(): Promise<Conversation[]> {
    await this.pending;
    const document: SessionDocument = await this.read();
    return document.conversations.sort((a: Conversation, b: Conversation) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Conversation | null> {
    const items: Conversation[] = await this.list();
    return items.find((item: Conversation) => item.id === id) || null;
  }

  save(conversation: Conversation): Promise<void> {
    // 入队时获取快照，防止调用者在异步写入期间改变对象。
    const snapshot: Conversation = JSON.parse(JSON.stringify(conversation)) as Conversation;
    const operation: Promise<void> = this.pending.then(async () => {
      const document: SessionDocument = await this.read();
      document.conversations = document.conversations.filter((item: Conversation) => item.id !== snapshot.id);
      document.conversations.push(snapshot);
      await this.store.set(this.key, JSON.stringify(document));
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  delete(id: string): Promise<void> {
    const operation: Promise<void> = this.pending.then(async () => {
      const document: SessionDocument = await this.read();
      document.conversations = document.conversations.filter((item: Conversation) => item.id !== id);
      await this.store.set(this.key, JSON.stringify(document));
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  private async read(): Promise<SessionDocument> {
    const raw: string = await this.store.get(this.key);
    if (raw === '') { return { version: 1, conversations: [] }; }
    try {
      const document: SessionDocument = JSON.parse(raw) as SessionDocument;
      if (document === null || document.version !== 1 || !Array.isArray(document.conversations)) {
        throw new Error('Invalid document');
      }
      const ids: Set<string> = new Set<string>();
      for (const conversation of document.conversations) {
        if (conversation === null || typeof conversation.id !== 'string' || ids.has(conversation.id) ||
          typeof conversation.title !== 'string' || typeof conversation.updatedAt !== 'number' ||
          !Array.isArray(conversation.messages) || !conversation.messages.every((message: ChatMessage) =>
            this.validMessage(message))) {
          throw new Error('Invalid conversation');
        }
        ids.add(conversation.id);
      }
      return document;
    } catch {
      throw new Error('STORAGE_CORRUPT: 会话文件损坏或版本不兼容。请先备份，避免覆盖历史。');
    }
  }

  private validMessage(message: ChatMessage): boolean {
    return message !== null && typeof message.id === 'string' && typeof message.content === 'string' &&
      typeof message.createdAt === 'number' && typeof message.toolCallId === 'string' &&
      ['system', 'user', 'assistant', 'tool'].includes(message.role) && Array.isArray(message.toolCalls) &&
      message.toolCalls.every((call: ToolCall) => call !== null && typeof call.id === 'string' &&
        typeof call.name === 'string' && typeof call.input === 'string');
  }
}
