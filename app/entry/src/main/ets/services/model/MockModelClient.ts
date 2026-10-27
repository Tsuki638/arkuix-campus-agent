import type { ModelClient } from '../../contracts/Ports';
import type { ChatMessage, ModelReply, ToolDefinition, ToolResult } from '../../contracts/Models';
import { newId } from '../../contracts/Models';

interface MockPlanInput { goal: string; days: number; }

// 明确的离线替身，不计入“真实大模型调用”验收。只有本类使用固定的输入格式。
export class MockModelClient implements ModelClient {
  async complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelReply> {
    const last: ChatMessage = messages[messages.length - 1];
    if (last.role === 'tool') {
      const result: ToolResult = JSON.parse(last.content) as ToolResult;
      return { content: result.success ? '已调用学习计划工具：\n' + result.content :
        '工具未完成：' + result.content + '\n请补充正确的目标和天数。', toolCalls: [] };
    }
    const parts: string[] = last.content.split('|');
    const days: number = Number(parts[1]);
    if (parts.length !== 2 || parts[0].trim().length === 0 || !Number.isInteger(days) || days < 1 || days > 30) {
      const userTurns: number = messages.filter((message: ChatMessage) => message.role === 'user').length;
      return { content: '这是第 ' + userTurns + ' 轮交流。请告诉我学习目标和可用天数。' +
        '离线演示请发送“复习高数|3”（天数 1–30）；真实模型接入后支持自然语言。', toolCalls: [] };
    }
    if (!tools.some((tool: ToolDefinition) => tool.name === 'create_study_plan')) {
      return { content: '学习计划工具尚未注册。', toolCalls: [] };
    }
    const input: MockPlanInput = { goal: parts[0].trim(), days: days };
    return { content: '正在生成学习计划。', toolCalls: [{ id: newId('call'), name: 'create_study_plan',
      input: JSON.stringify(input) }] };
  }
}
