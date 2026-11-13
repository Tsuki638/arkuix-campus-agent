import type { CalendarOperation, LearningState, TimeWindow } from './LearningModels';

export interface LearningRepository {
  load(conversationId: string): Promise<LearningState | null>;
  save(state: LearningState): Promise<void>;
  delete(conversationId: string): Promise<void>;
}

export interface CalendarReadResult {
  readable: boolean;
  // 无标识的忙碌时段始终保留；带标识时 A 可排除本应用待替换的已保存关联。
  busy: (TimeWindow & { eventId?: string; appEventKey?: string })[];
  reason: string;
}

export interface CalendarReceipt {
  status: 'succeeded' | 'failed' | 'unknown';
  eventId: string;
  error: string;
}

// D 的适配必须核验应用归属和 operationKey 去重；reconcile.failed 表示已确定未执行。
export interface CalendarPort {
  readBusy(startAt: string, endAt: string): Promise<CalendarReadResult>;
  prepareWrite?(): Promise<void>;
  reconcile(operation: CalendarOperation): Promise<CalendarReceipt>;
  apply(operation: CalendarOperation): Promise<CalendarReceipt>;
}
