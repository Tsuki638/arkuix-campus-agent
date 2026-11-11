import common from '@ohos.app.ability.common';
import deviceInfo from '@ohos.deviceInfo';
import { CalendarService } from '../../contracts/Calendar';
import { UnavailableCalendarService } from './UnavailableCalendarService';

export async function createPlatformCalendar(context: common.Context): Promise<CalendarService> {
  const os: string = deviceInfo.osFullName;
  if (os.startsWith('Android') || os.startsWith('iOS') || os.startsWith('iPadOS') || os.startsWith('macOS')) {
    return new UnavailableCalendarService('当前平台的日历桥接尚未接入；可预览草案，请在鸿蒙端确认写入。');
  }
  if (!canIUse('SystemCapability.Applications.CalendarData')) {
    return new UnavailableCalendarService('此设备未提供系统日历能力，草案可以保留。');
  }
  try {
    const module = await import('./HarmonyCalendarService');
    return new module.HarmonyCalendarService(context);
  } catch { return new UnavailableCalendarService('系统日历模块加载失败，请检查设备能力。'); }
}
