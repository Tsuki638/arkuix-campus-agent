import type { AgentTool } from '../../contracts/Ports';
import type { ToolDefinition, ToolResult } from '../../contracts/Models';
import type { CalendarDraft, CalendarEventInput } from '../../contracts/Calendar';
import type { ToolContext } from '../../contracts/LearningModels';
import { CalendarCoordinator } from '../../services/calendar/CalendarCoordinator';
import { StudyDataRepository } from '../../services/storage/StudyDataRepository';
import type { PlanVersion, PlanTask } from '../../services/storage/StudyDataRepository';

interface PrepareCalendarInput { timeZone: string; planId?: string; events: CalendarEventInput[]; }

export class PrepareCalendarEventsTool implements AgentTool {
  private calendar: CalendarCoordinator;
  private study: StudyDataRepository;
  constructor(calendar: CalendarCoordinator, study: StudyDataRepository) { this.calendar = calendar; this.study = study; }
  definition(): ToolDefinition {
    return { name: 'prepare_calendar_events',
      description: '为系统日历准备可编辑日程草案，尚不写入。必须明确日期、开始和结束时间，首版使用北京时间。' +
        '用户须在日程预览页面点击确认才会写入。关联已有计划时先读取计划任务 ID；无法确定则不填写 planId 和 taskId。',
      parametersJson: '{"type":"object","properties":{"timeZone":{"type":"string","enum":["Asia/Shanghai"]},' +
        '"planId":{"type":"string"},"events":{"type":"array","minItems":1,"maxItems":30,"items":{' +
        '"type":"object","properties":{"title":{"type":"string"},"startTime":{"type":"string",' +
        '"description":"明确时间，例如 2026-11-12T19:00:00+08:00"},"endTime":{"type":"string"},' +
        '"reminderMinutes":{"type":"array","maxItems":3,"items":{"type":"integer","minimum":0,"maximum":10080}},' +
        '"taskId":{"type":"string"},"description":{"type":"string"}},' +
        '"required":["title","startTime","endTime","reminderMinutes"],"additionalProperties":false}}},' +
        '"required":["timeZone","events"],"additionalProperties":false}' };
  }
  async execute(input: string, context?: ToolContext): Promise<ToolResult> {
    try {
      if (context === undefined || !context.conversationId) { throw new Error('CALENDAR_CONTEXT: 缺少当前会话。'); }
      const value: PrepareCalendarInput = JSON.parse(input) as PrepareCalendarInput;
      if (value === null || value.timeZone !== 'Asia/Shanghai' || !Array.isArray(value.events) ||
        (value.planId !== undefined && typeof value.planId !== 'string')) {
        throw new Error('CALENDAR_INPUT: 请提供北京时间和日程列表。');
      }
      if (value.planId) {
        const plan: PlanVersion | null = await this.study.getPlan(value.planId);
        if (plan === null || !value.events.every((event: CalendarEventInput) => event !== null &&
          plan.tasks.some((task: PlanTask) => task.id === event.taskId && task.status !== 'done'))) {
          throw new Error('CALENDAR_INPUT: 关联计划或待完成任务不存在。');
        }
      }
      const draft: CalendarDraft = await this.calendar.prepare(context.conversationId, value.planId || '', value.events);
      return { name: 'prepare_calendar_events', success: true,
        content: JSON.stringify({ status: draft.status === 'completed' ? 'created' : 'pending_confirmation',
          draft: draft, message: '请在「日程预览」查看具体内容并点击确认；pending 日程尚未写入系统日历。' }) };
    } catch (error) {
      const message: string = (error as Error).message || '';
      return { name: 'prepare_calendar_events', success: false,
        content: message.startsWith('CALENDAR_') ? message : 'CALENDAR_INPUT: 日程参数或保存失败，请检查后重试。' };
    }
  }
}

export class ListCalendarDraftsTool implements AgentTool {
  private calendar: CalendarCoordinator;
  constructor(calendar: CalendarCoordinator) { this.calendar = calendar; }
  definition(): ToolDefinition {
    return { name: 'list_calendar_drafts', description: '读取当前会话的日程草案、最近一次写入结果与系统日程 ID。' +
      '只读本地同步记录，不检查用户在系统日历中的后续手动修改或删除。',
      parametersJson: '{"type":"object","properties":{},"additionalProperties":false}' };
  }
  async execute(_input: string, context?: ToolContext): Promise<ToolResult> {
    if (context === undefined || !context.conversationId) {
      return { name: 'list_calendar_drafts', success: false, content: 'CALENDAR_CONTEXT: 缺少当前会话。' };
    }
    return { name: 'list_calendar_drafts', success: true,
      content: JSON.stringify(await this.calendar.list(context.conversationId)) };
  }
}

export class ListStudyPlansTool implements AgentTool {
  private study: StudyDataRepository;
  constructor(study: StudyDataRepository) { this.study = study; }
  definition(): ToolDefinition {
    return { name: 'list_study_plans', description: '读取应用内已保存的学习计划、计划 ID 和任务 ID，为安排日历时关联真实任务。只读。',
      parametersJson: '{"type":"object","properties":{},"additionalProperties":false}' };
  }
  async execute(_input: string): Promise<ToolResult> {
    return { name: 'list_study_plans', success: true, content: JSON.stringify(await this.study.listPlans()) };
  }
}
