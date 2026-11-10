import type { ModelClient } from '../../contracts/Ports';
import type { ChatMessage, ModelReply, ToolDefinition, ToolResult } from '../../contracts/Models';
import { newId } from '../../contracts/Models';

interface MockTask { name: string; minutes: number; }
interface MockPlanInput { goal?: string; days?: number; minutesPerDay?: number; tasks?: MockTask[]; }

// 明确的离线替身：只合并用户的 JSON 参数，不模拟自然语言理解，不计入真实云模型验收。
export class MockModelClient implements ModelClient {
  async complete(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelReply> {
    const last: ChatMessage = messages[messages.length - 1];
    if (last.role === 'tool') {
      const result: ToolResult = JSON.parse(last.content) as ToolResult;
      return { content: result.success ? (result.name === 'create_study_plan' ? '已调用学习计划工具：\n' :
        '离线工具执行结果（' + result.name + '）：\n') + result.content :
        '工具未完成：' + result.content + '\n请补充或调整条件。', toolCalls: [] };
    }
    const userTurns: number = messages.filter((message: ChatMessage) => message.role === 'user').length;
    // 新产品的可重复工具演示格式。真正自然语言到工具的选择由 C 的云模型实现。
    try {
      const envelope = JSON.parse(last.content) as { tool: string; input: Object };
      if (envelope !== null && typeof envelope.tool === 'string' && envelope.input !== null &&
        typeof envelope.input === 'object' && !Array.isArray(envelope.input)) {
        return { content: '正在执行工具：' + envelope.tool, toolCalls: [{ id: newId('call'),
          name: envelope.tool, input: JSON.stringify(envelope.input) }] };
      }
    } catch { /* 继续支持原学习时间分配的分轮 JSON 输入。 */ }
    const latest: MockPlanInput | null = this.readUpdate(last.content);
    if (latest === null) {
      return this.clarify(userTurns, ['goal', 'days', 'minutesPerDay', 'tasks']);
    }
    // 保留应用内的“目标|天数”基础计划示例；分轮 JSON 仍须补齐按分钟排期的条件。
    if (!last.content.trim().startsWith('{') && last.content.includes('|') &&
      tools.some((tool: ToolDefinition) => tool.name === 'create_study_plan' &&
        tool.parametersJson.includes('"required":["goal","days"]'))) {
      return { content: '正在生成基础学习计划。', toolCalls: [{ id: newId('call'), name: 'create_study_plan',
        input: JSON.stringify(latest) }] };
    }
    // 从会话历史重建条件，避免模型实例被多个会话共用时串数据；最后一次出现的字段覆盖前值。
    const input: MockPlanInput = {};
    for (const message of messages) {
      if (message.role !== 'user') { continue; }
      const update: MockPlanInput | null = this.readUpdate(message.content);
      if (update === null) { continue; }
      if (update.goal !== undefined) { input.goal = update.goal; }
      if (update.days !== undefined) { input.days = update.days; }
      if (update.minutesPerDay !== undefined) { input.minutesPerDay = update.minutesPerDay; }
      if (update.tasks !== undefined) { input.tasks = update.tasks; }
    }
    const missing: string[] = [];
    if (input.goal === undefined) { missing.push('学习目标 goal'); }
    if (input.days === undefined) { missing.push('可用天数 days'); }
    if (input.minutesPerDay === undefined) { missing.push('每天可用分钟数 minutesPerDay'); }
    if (input.tasks === undefined) { missing.push('任务列表 tasks（每项含 name 和预计分钟数 minutes）'); }
    if (missing.length > 0) { return this.clarify(userTurns, missing); }
    if (!tools.some((tool: ToolDefinition) => tool.name === 'create_study_plan')) {
      return { content: '学习计划工具尚未注册。', toolCalls: [] };
    }
    return { content: '正在生成学习计划。', toolCalls: [{ id: newId('call'), name: 'create_study_plan',
      input: JSON.stringify(input) }] };
  }

  private readUpdate(text: string): MockPlanInput | null {
    try {
      const value: MockPlanInput = JSON.parse(text) as MockPlanInput;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) { return null; }
      const keys: string[] = Object.keys(value);
      return keys.length > 0 && keys.every((key: string) =>
        ['goal', 'days', 'minutesPerDay', 'tasks'].indexOf(key) >= 0) ? value : null;
    } catch {
      // 兼容旧演示入口，仅预填目标和天数；不再为缺失的任务、每日时间编造默认值。
      const parts: string[] = text.split('|');
      if (parts.length === 2 && parts[0].trim().length > 0 && parts[1].trim().length > 0) {
        return { goal: parts[0].trim(), days: Number(parts[1]) };
      }
      return null;
    }
  }

  private clarify(turns: number, missing: string[]): ModelReply {
    return { content: '这是第 ' + turns + ' 轮交流。请补充：' + missing.join('、') + '。\n' +
      '离线模式请发送 JSON，可分轮补充或修改，例如 {"goal":"复习高数"}，然后发送 ' +
      '{"days":3,"minutesPerDay":90,"tasks":[{"name":"极限","minutes":60}]}。' +
      '接入真实云模型后再验证自然语言对话。', toolCalls: [] };
  }
}
