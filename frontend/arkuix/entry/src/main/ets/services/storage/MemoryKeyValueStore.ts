import type { KeyValueStore } from '../../contracts/Ports';

// 单元检查和无设备开发专用；不属于本地持久化实现。
export class MemoryKeyValueStore implements KeyValueStore {
  private values: Map<string, string> = new Map<string, string>();

  async get(key: string): Promise<string> { return this.values.get(key) || ''; }
  async set(key: string, value: string): Promise<void> { this.values.set(key, value); }
}
