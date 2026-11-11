import common from '@ohos.app.ability.common';
import abilityAccessCtrl from '@ohos.abilityAccessCtrl';
import { calendarManager } from '@kit.CalendarKit';
import { CalendarEntry, CalendarEventReference, CalendarService } from '../../contracts/Calendar';

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

  private async ownCalendar(): Promise<calendarManager.Calendar> {
    const manager: calendarManager.CalendarManager = calendarManager.getCalendarManager(this.context);
    const calendars: calendarManager.Calendar[] = await manager.getAllCalendars();
    const existing: calendarManager.Calendar | undefined = calendars.find((calendar: calendarManager.Calendar) =>
      calendar.getAccount().name === 'campus-agent' && calendar.getAccount().type === calendarManager.CalendarType.LOCAL);
    if (existing !== undefined) { return existing; }
    const calendar: calendarManager.Calendar = await manager.createCalendar({
      name: 'campus-agent', type: calendarManager.CalendarType.LOCAL, displayName: '学习计划'
    });
    await calendar.setConfig({ enableReminder: true });
    return calendar;
  }

  async findEvent(event: CalendarEntry): Promise<CalendarEventReference | null> {
    const calendar: calendarManager.Calendar = await this.ownCalendar();
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
}
