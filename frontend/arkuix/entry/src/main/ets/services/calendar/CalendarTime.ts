import type { PlanTask, PlanVersion } from '../storage/StudyDataRepository';
import type { CalendarEventInput } from '../../contracts/Calendar';

function pad(value: number): string { return value.toString().padStart(2, '0'); }

export function calendarTimeText(timestamp: number): string {
  const date: Date = new Date(timestamp + 8 * 60 * 60 * 1000);
  return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate()) +
    ' ' + pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes());
}

export function calendarInputTime(text: string): string {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(text.trim())) {
    throw new Error('CALENDAR_INPUT: 请按 YYYY-MM-DD HH:mm 填写时间。');
  }
  return text.trim().replace(' ', 'T').slice(0, 16) + ':00+08:00';
}

export function parseCalendarTime(text: string): number {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+08:00$/.test(text)) {
    throw new Error('CALENDAR_INPUT: 请使用带 +08:00 的明确日期和时间。');
  }
  const timestamp: number = Date.parse(text);
  if (!Number.isFinite(timestamp) || calendarTimeText(timestamp).replace(' ', 'T') !== text.slice(0, 16)) {
    throw new Error('CALENDAR_INPUT: 日期或时间无效，请检查后重试。');
  }
  return timestamp;
}

// 仅准备可编辑草案，界面明确显示默认时段；此函数没有日历写入能力。
export function planCalendarInputs(plan: PlanVersion, now: number): CalendarEventInput[] {
  const today: string = calendarTimeText(now).slice(0, 10);
  const tomorrowEvening: number = Date.parse(today + 'T19:00:00+08:00') + 24 * 60 * 60 * 1000;
  return plan.tasks.filter((task: PlanTask) => task.status !== 'done').map((task: PlanTask): CalendarEventInput => {
    const start: number = tomorrowEvening + (task.day - 1) * 24 * 60 * 60 * 1000;
    return { taskId: task.id, title: task.title,
      startTime: calendarInputTime(calendarTimeText(start)),
      endTime: calendarInputTime(calendarTimeText(start + 60 * 60 * 1000)),
      reminderMinutes: [10], description: '学习计划：' + plan.conditions.goal };
  });
}
