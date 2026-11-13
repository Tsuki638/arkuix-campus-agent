import common from '@ohos.app.ability.common';
import abilityAccessCtrl from '@ohos.abilityAccessCtrl';
import { calendarManager } from '@kit.CalendarKit';
import { CalendarEntry, CalendarEventMatch, CalendarEventReference, CalendarService } from '../../contracts/Calendar';

// 仅操作本应用的本地日历账户。由工厂在系统能力检查后延迟加载。
export class HarmonyCalendarService implements CalendarService {
  private context: common.Context;
  constructor(context: common.Context) { this.context = context; }
  isAvailable(): boolean { return true; }
  unavailableReason(): string { return ''; }

  async requestPermission(): Promise<boolean> {
    const manager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
    const result = await manager.requestPermissionsFromUser(this.context,
      ['ohos.permission.READ_CALENDAR', 'ohos.permission.WRITE_CALENDAR']);
    return result.authResults.length === 2 && result.authResults.every((status: number) => status === 0);
  }

  private async findOwnCalendar(): Promise<calendarManager.Calendar | undefined> {
    const manager: calendarManager.CalendarManager = calendarManager.getCalendarManager(this.context);
    const calendars: calendarManager.Calendar[] = await manager.getAllCalendars();
    return calendars.find((calendar: calendarManager.Calendar) =>
      calendar.getAccount().name === 'campus-agent' && calendar.getAccount().type === calendarManager.CalendarType.LOCAL);
  }

  private async ownCalendar(): Promise<calendarManager.Calendar> {
    const existing: calendarManager.Calendar | undefined = await this.findOwnCalendar();
    if (existing !== undefined) { return existing; }
    const manager: calendarManager.CalendarManager = calendarManager.getCalendarManager(this.context);
    const calendar: calendarManager.Calendar = await manager.createCalendar({
      name: 'campus-agent', type: calendarManager.CalendarType.LOCAL, displayName: '学习计划'
    });
    await calendar.setConfig({ enableReminder: true });
    return calendar;
  }

  async findEvent(event: CalendarEntry): Promise<CalendarEventReference | null> {
    const calendar: calendarManager.Calendar | undefined = await this.findOwnCalendar();
    if (calendar === undefined) { return null; }
    const events: calendarManager.Event[] = await calendar.getEvents();
    const existing: calendarManager.Event | undefined = events.find((item: calendarManager.Event) => item.identifier === event.id);
    if (existing === undefined || existing.id === undefined) { return null; }
    return { calendarId: calendar.id, eventId: existing.id };
  }

  async createEvent(event: CalendarEntry): Promise<CalendarEventReference> {
    const calendar: calendarManager.Calendar = await this.ownCalendar();
    const eventId: number = await calendar.addEvent({ type: calendarManager.EventType.NORMAL,
      title: event.title, startTime: event.startTime, endTime: event.endTime, timeZone: event.timeZone,
      isAllDay: false, reminderTime: event.reminderMinutes, description: event.description,
      identifier: event.id });
    return { calendarId: calendar.id, eventId: eventId };
  }

  async matchesEvent(entry: CalendarEntry, reference: CalendarEventReference): Promise<CalendarEventMatch> {
    const calendar: calendarManager.Calendar | undefined = await this.findOwnCalendar();
    if (calendar === undefined) { return 'missing'; }
    if (calendar.id !== reference.calendarId) { return 'unowned'; }
    const events: calendarManager.Event[] = await calendar.getEvents();
    const event: calendarManager.Event | undefined = events.find((item: calendarManager.Event) =>
      item.id === reference.eventId || item.identifier === entry.id);
    if (event === undefined) { return 'missing'; }
    if (event.id !== reference.eventId || event.identifier !== entry.id) { return 'unowned'; }
    const reminders: number[] = event.reminderTime ?? [];
    const matches: boolean = event.title === entry.title && event.startTime === entry.startTime && event.endTime === entry.endTime &&
      reminders.length === entry.reminderMinutes.length &&
      reminders.every((minute: number, index: number) => minute === entry.reminderMinutes[index]);
    if (matches) { return 'matches'; }
    return event.startTime <= Date.now() ? 'past' : 'different';
  }

  private async requireOwnedEvent(entry: CalendarEntry, reference: CalendarEventReference): Promise<calendarManager.Calendar> {
    const calendar: calendarManager.Calendar | undefined = await this.findOwnCalendar();
    if (calendar === undefined || calendar.id !== reference.calendarId) { throw new Error('CALENDAR_OWNERSHIP'); }
    const events: calendarManager.Event[] = await calendar.getEvents();
    const event = events.find((item: calendarManager.Event) => item.id === reference.eventId && item.identifier === entry.id);
    if (event === undefined) { throw new Error('CALENDAR_OWNERSHIP'); }
    if (event.startTime <= Date.now()) { throw new Error('CALENDAR_PAST'); }
    return calendar;
  }

  async updateEvent(entry: CalendarEntry, reference: CalendarEventReference): Promise<void> {
    const calendar: calendarManager.Calendar = await this.requireOwnedEvent(entry, reference);
    await calendar.updateEvent({ id: reference.eventId, type: calendarManager.EventType.NORMAL, title: entry.title,
      startTime: entry.startTime, endTime: entry.endTime, timeZone: entry.timeZone, isAllDay: false,
      reminderTime: entry.reminderMinutes, description: entry.description, identifier: entry.id });
  }

  async deleteEvent(entry: CalendarEntry, reference: CalendarEventReference): Promise<void> {
    const calendar: calendarManager.Calendar = await this.requireOwnedEvent(entry, reference);
    await calendar.deleteEvent(reference.eventId);
  }
}
