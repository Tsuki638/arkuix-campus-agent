import type { CalendarEntry, CalendarEventReference, CalendarService } from '../../contracts/Calendar';

export interface CalendarWriteResult {
  state: 'created' | 'failed' | 'uncertain';
  calendarId: number;
  eventId: number;
  error: string;
}

export async function requireCalendarPermission(service: CalendarService): Promise<void> {
  if (!service.isAvailable()) { throw new Error('CALENDAR_UNAVAILABLE: ' + service.unavailableReason()); }
  let permission: boolean = false;
  try { permission = await service.requestPermission(); }
  catch { throw new Error('CALENDAR_PERMISSION: 无法获取日历权限，请检查系统设置后重试，草案已保留。'); }
  if (!permission) {
    throw new Error('CALENDAR_PERMISSION: 未获得日历读写权限，草案已保留。');
  }
}

// 调用方须先持久化写入意图。重试时先按事件的稳定 identifier 查询系统日历。
export async function writeCalendarEntry(service: CalendarService, event: CalendarEntry): Promise<CalendarWriteResult> {
  try {
    let reference: CalendarEventReference | null = await service.findEvent(event);
    if (reference === null) {
      if (event.startTime <= Date.now()) {
        return { state: 'failed', calendarId: 0, eventId: 0, error: '开始时间已过，请取消此草案并重新安排。' };
      }
      reference = await service.createEvent(event);
    }
    if (!Number.isInteger(reference.eventId) || reference.eventId <= 0 ||
      !Number.isInteger(reference.calendarId) || reference.calendarId < 0) {
      throw new Error('Invalid calendar reference');
    }
    return { state: 'created', calendarId: reference.calendarId, eventId: reference.eventId, error: '' };
  } catch {
    return { state: 'uncertain', calendarId: 0, eventId: 0,
      error: '系统结果未确认；重试时会先查询已有日程，避免重复创建。' };
  }
}
