import type { CalendarPort, CalendarReadResult, CalendarReceipt } from '../../contracts/LearningPorts';
import type { CalendarOperation } from '../../contracts/LearningModels';

export class UnavailableCalendarPort implements CalendarPort {
  async readBusy(_startAt: string, _endAt: string): Promise<CalendarReadResult> {
    return { readable: false, busy: [], reason: 'CALENDAR_UNAVAILABLE: 日历未接入，使用用户提供的空闲时段。' };
  }

  async reconcile(_operation: CalendarOperation): Promise<CalendarReceipt> {
    return { status: 'failed', eventId: '', error: 'CALENDAR_UNAVAILABLE: 未接入设备日历，没有执行写入。' };
  }

  async apply(_operation: CalendarOperation): Promise<CalendarReceipt> {
    return { status: 'failed', eventId: '', error: 'CALENDAR_UNAVAILABLE: 请由 D 注入平台日历适配。' };
  }
}
