import type { CalendarEntry, CalendarEventReference, CalendarService } from '../../contracts/Calendar';

export class UnavailableCalendarService implements CalendarService {
  private reason: string;
  constructor(reason: string = '当前环境未接入系统日历，可预览草案；请在支持的鸿蒙设备上确认写入。') {
    this.reason = reason;
  }
  isAvailable(): boolean { return false; }
  unavailableReason(): string { return this.reason; }
  async requestPermission(): Promise<boolean> { return false; }
  async findEvent(_event: CalendarEntry): Promise<CalendarEventReference | null> {
    throw new Error('CALENDAR_UNAVAILABLE: ' + this.reason);
  }
  async createEvent(_event: CalendarEntry): Promise<CalendarEventReference> {
    throw new Error('CALENDAR_UNAVAILABLE: ' + this.reason);
  }
}
