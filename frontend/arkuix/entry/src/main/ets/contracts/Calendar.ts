// 日历边界与原有计划文档分开存储，已有 study_data_v1 无需迁移。
export interface CalendarEventInput {
  title: string;
  startTime: string; // YYYY-MM-DDTHH:mm:ss+08:00；首版明确使用北京时间。
  endTime: string;
  reminderMinutes: number[];
  taskId?: string;
  description?: string;
}

export type CalendarEntryState = 'pending' | 'writing' | 'created' | 'failed' | 'uncertain';
export interface CalendarEntry {
  id: string; // 同时作为写入系统日历的稳定 identifier，用于中断恢复。
  taskId: string;
  title: string;
  startTime: number;
  endTime: number;
  timeZone: string;
  reminderMinutes: number[];
  description: string;
  state: CalendarEntryState;
  calendarId: number;
  eventId: number;
  error: string;
}

export interface CalendarDraft {
  id: string;
  conversationId: string;
  planId: string;
  revision: number;
  createdAt: number;
  status: 'pending' | 'completed' | 'cancelled';
  events: CalendarEntry[];
}

export interface CalendarEventReference { calendarId: number; eventId: number; }
export interface ToolExecutionContext { conversationId: string; }

export interface CalendarService {
  isAvailable(): boolean;
  unavailableReason(): string;
  requestPermission(): Promise<boolean>;
  findEvent(event: CalendarEntry): Promise<CalendarEventReference | null>;
  createEvent(event: CalendarEntry): Promise<CalendarEventReference>;
}
