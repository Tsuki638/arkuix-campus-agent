import type { ChatMessage } from '../../contracts/Models';
import { makeMessage } from '../../contracts/Models';

export const DEFAULT_MAX_CONTEXT_CHARS: number = 24000;
const SUMMARY_MESSAGE_ID: string = 'conversation-summary';

export function makeSummaryMessage(summary: string): ChatMessage {
  const message: ChatMessage = makeMessage('user', '【旧对话摘要】\n' + summary);
  message.id = SUMMARY_MESSAGE_ID;
  return message;
}

function messageCost(message: ChatMessage): number {
  let cost: number = message.content.length + (message.reasoningContent === undefined ? 0 : message.reasoningContent.length);
  for (const call of message.toolCalls) {
    cost += call.name.length + call.input.length;
  }
  return cost;
}

export function contextCost(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + messageCost(message), 0);
}

export function splitContextTurns(messages: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = [];
  let turn: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user' && turn.length > 0) {
      turns.push(turn);
      turn = [];
    }
    turn.push(message);
  }
  if (turn.length > 0) { turns.push(turn); }
  return turns;
}

// 按用户轮次裁剪，保留历史摘要与当前轮的输入及工具往返。
export function trimContext(messages: ChatMessage[], maxChars: number = DEFAULT_MAX_CONTEXT_CHARS): ChatMessage[] {
  let headLength: number = messages.length > 0 && messages[0].role === 'system' ? 1 : 0;
  if (headLength === 1 && messages.length > 1 && messages[1].id === SUMMARY_MESSAGE_ID) {
    headLength += 1;
  }
  const head: ChatMessage[] = messages.slice(0, headLength);
  const turns: ChatMessage[][] = splitContextTurns(messages.slice(headLength));

  const kept: ChatMessage[] = [];
  let used: number = contextCost(head);
  for (let i: number = turns.length - 1; i >= 0; i -= 1) {
    const current: ChatMessage[] = turns[i];
    const cost: number = contextCost(current);
    if (used + cost <= maxChars || i === turns.length - 1) {
      kept.unshift(...current);
      used += cost;
      continue;
    }

    // 上一轮的工具数据过长时，优先保留原问题和最后的回复，以便继续追问。
    const question: ChatMessage = current[0];
    const reply: ChatMessage = current[current.length - 1];
    if (i === turns.length - 2 && question.role === 'user' &&
      reply.role === 'assistant' && reply.toolCalls.length === 0 &&
      used + messageCost(question) + messageCost(reply) <= maxChars) {
      kept.unshift(question, reply);
    }
    break;
  }
  return head.concat(kept);
}
