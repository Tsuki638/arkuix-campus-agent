import type { ChatMessage } from '../../contracts/Models';

export const DEFAULT_MAX_CONTEXT_CHARS: number = 24000;

function messageCost(message: ChatMessage): number {
  let cost: number = message.content.length;
  for (const call of message.toolCalls) {
    cost += call.name.length + call.input.length;
  }
  return cost;
}

// 按“assistant 工具请求 + 其全部 tool 结果”整组丢弃最早上下文，
// 保证送进模型的历史里不会出现未配对的调用或孤立结果。
export function trimContext(messages: ChatMessage[], maxChars: number = DEFAULT_MAX_CONTEXT_CHARS): ChatMessage[] {
  const head: ChatMessage[] = messages.length > 0 && messages[0].role === 'system' ? [messages[0]] : [];
  const rest: ChatMessage[] = messages.slice(head.length);
  const groups: ChatMessage[][] = [];
  let index: number = 0;
  while (index < rest.length) {
    const current: ChatMessage = rest[index];
    if (current.role === 'assistant' && current.toolCalls.length > 0) {
      const ids: Set<string> = new Set(current.toolCalls.map((call) => call.id));
      const group: ChatMessage[] = [current];
      let next: number = index + 1;
      while (next < rest.length && rest[next].role === 'tool' && ids.has(rest[next].toolCallId)) {
        group.push(rest[next]);
        next += 1;
      }
      groups.push(group);
      index = next;
    } else {
      groups.push([current]);
      index += 1;
    }
  }
  const kept: ChatMessage[] = [];
  let used: number = head.reduce((total, message) => total + messageCost(message), 0);
  for (let group: number = groups.length - 1; group >= 0; group -= 1) {
    const cost: number = groups[group].reduce((total, message) => total + messageCost(message), 0);
    if (used + cost > maxChars && kept.length > 0) {
      break;
    }
    kept.unshift(...groups[group]);
    used += cost;
  }
  return head.concat(kept);
}
