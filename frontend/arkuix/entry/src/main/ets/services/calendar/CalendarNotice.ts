import { makeMessage } from '../../contracts/Models';
import type { ChatMessage } from '../../contracts/Models';

const NOTICE_ID_PREFIX: string = 'calendar-notice-';
const NOTICE_HEADING: string = '【应用执行结果】\n';

export function makeCalendarNotice(summary: string): ChatMessage {
  const message: ChatMessage = makeMessage('assistant', NOTICE_HEADING + summary);
  message.id = NOTICE_ID_PREFIX + message.id;
  return message;
}

export function isCalendarNotice(message: ChatMessage): boolean {
  return message.role === 'assistant' && message.toolCalls.length === 0 &&
    (message.id.startsWith(NOTICE_ID_PREFIX) ||
      // 兼容修复前已保存、没有专用 ID 的回执。
      message.content.startsWith(NOTICE_HEADING + '系统日历执行结果：已创建 '));
}
