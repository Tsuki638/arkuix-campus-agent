import type { CalendarEntry, CalendarEventReference, CalendarService } from '../../contracts/Calendar';
import type { CalendarOperation } from '../../contracts/LearningModels';
import type { CalendarPort, CalendarReadResult, CalendarReceipt } from '../../contracts/LearningPorts';

export class LearningCalendarAdapter implements CalendarPort {
  private service: CalendarService;

  constructor(service: CalendarService) { this.service = service; }

  async readBusy(_startAt: string, _endAt: string): Promise<CalendarReadResult> {
    return { readable: false, busy: [], reason: '当前日历服务仅访问应用自己的日历账户，排期使用用户提供的空闲时段。' };
  }

  async prepareWrite(): Promise<void> {
    if (!this.service.isAvailable()) { throw new Error('CALENDAR_UNAVAILABLE: ' + this.service.unavailableReason()); }
    let allowed: boolean = false;
    try { allowed = await this.service.requestPermission(); } catch { /* 保留预览供用户重试。 */ }
    if (!allowed) { throw new Error('CALENDAR_PERMISSION: 未获得日历读写权限，预览已保留。'); }
  }

  async reconcile(operation: CalendarOperation): Promise<CalendarReceipt> {
    const entry = this.entry(operation);
    if (operation.kind === 'create') {
      const reference = await this.service.findEvent(entry);
      return reference === null ? this.failed('日程尚未创建。') : this.receipt(reference);
    }
    const reference = this.parseReference(operation.eventId);
    if (reference === null) { return this.failed('原日程标识无效。'); }
    if (this.service.matchesEvent === undefined) { return this.unsupported(); }
    const match = await this.service.matchesEvent(entry, reference);
    if (match === 'past') { return this.failed('原系统日程已经开始，已保留原记录。'); }
    if ((operation.kind === 'update' && match === 'matches') || (operation.kind === 'delete' && match === 'missing')) {
      return this.receipt(reference);
    }
    if (match === 'unowned' || match === 'missing') { return this.failed('原日程不存在或归属无法核验。'); }
    return this.failed('日程仍待变更。');
  }

  async apply(operation: CalendarOperation): Promise<CalendarReceipt> {
    const entry = this.entry(operation);
    if (operation.kind === 'create') { return this.receipt(await this.service.createEvent(entry)); }
    const reference = this.parseReference(operation.eventId);
    if (reference === null) { return this.failed('原日程标识无效。'); }
    if (this.service.matchesEvent === undefined) { return this.unsupported(); }
    const match = await this.service.matchesEvent(entry, reference);
    if (match === 'past') { return this.failed('原系统日程已经开始，已保留原记录。'); }
    if (match === 'unowned' || (operation.kind === 'update' && match === 'missing')) {
      return this.failed('原日程不存在或归属无法核验。');
    }
    if (operation.kind === 'update' && match === 'different') {
      if (this.service.updateEvent === undefined) { return this.unsupported(); }
      await this.service.updateEvent(entry, reference);
    } else if (operation.kind === 'delete' && match !== 'missing') {
      if (this.service.deleteEvent === undefined) { return this.unsupported(); }
      await this.service.deleteEvent(entry, reference);
    }
    return this.receipt(reference);
  }

  private unsupported(): CalendarReceipt {
    return this.failed('当前设备日历适配不支持此变更，原系统日程仍保留。');
  }

  private failed(message: string): CalendarReceipt {
    return { status: 'failed', eventId: '', error: message };
  }

  private parseReference(id: string): CalendarEventReference | null {
    if (!/^\d+:[1-9]\d*$/.test(id)) { return null; }
    const parts = id.split(':');
    const calendarId = Number(parts[0]);
    const eventId = Number(parts[1]);
    if (!Number.isSafeInteger(calendarId) || !Number.isSafeInteger(eventId)) { return null; }
    return { calendarId: calendarId, eventId: eventId };
  }

  private receipt(reference: CalendarEventReference): CalendarReceipt {
    if (!Number.isInteger(reference.calendarId) || reference.calendarId < 0 ||
      !Number.isInteger(reference.eventId) || reference.eventId <= 0) {
      return { status: 'unknown', eventId: '', error: '系统返回的日程标识无效，请查询后重试。' };
    }
    return { status: 'succeeded', eventId: reference.calendarId + ':' + reference.eventId, error: '' };
  }

  private entry(operation: CalendarOperation): CalendarEntry {
    return { id: operation.appEventKey, taskId: operation.taskId, title: operation.title,
      startTime: Date.parse(operation.startAt), endTime: Date.parse(operation.endAt), timeZone: 'Asia/Shanghai',
      reminderMinutes: operation.reminderMinutes > 0 ? [operation.reminderMinutes] : [],
      description: '', state: 'pending', calendarId: 0, eventId: 0, error: '' };
  }
}
