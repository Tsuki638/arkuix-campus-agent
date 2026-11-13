import type { AgentTool } from '../../contracts/Ports';
import type { ToolDefinition, ToolResult } from '../../contracts/Models';
import type { LearnerProfile, LearningTaskDraft, TimeWindow, ToolContext } from '../../contracts/LearningModels';
import { LearningPlanner } from './LearningPlanner';

interface ToolInput extends Partial<LearnerProfile> {
  pathId?: string;
  startAt?: string;
  tasks?: LearningTaskDraft[];
  from?: string;
  available?: TimeWindow[];
  reminderMinutes?: number;
  taskId?: string;
  status?: 'done' | 'pending';
  remainingMinutes?: number;
  dueAt?: string;
  dependsOn?: string[];
}

class LearningTool implements AgentTool {
  private spec: ToolDefinition;
  private allowed: string[];
  private required: string[];
  private handler: (id: string, input: ToolInput) => Promise<Object>;

  constructor(name: string, description: string, properties: Object, required: string[],
    handler: (id: string, input: ToolInput) => Promise<Object>) {
    this.spec = { name: name, description: description,
      parametersJson: JSON.stringify({ type: 'object', properties: properties, required: required, additionalProperties: false }) };
    this.allowed = Object.keys(properties);
    this.required = required;
    this.handler = handler;
  }

  definition(): ToolDefinition { return this.spec; }

  async execute(input: string, context?: ToolContext): Promise<ToolResult> {
    try {
      if (context === undefined || !context.conversationId) { throw new Error('TOOL_CONTEXT_REQUIRED: 缺少当前会话。'); }
      const value: ToolInput = JSON.parse(input) as ToolInput;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) { throw new Error('INVALID_TOOL_INPUT: 参数须为 JSON 对象。'); }
      const keys = Object.keys(value);
      if (keys.some((key) => !this.allowed.includes(key)) || this.required.some((key) => !keys.includes(key))) {
        throw new Error('INVALID_TOOL_INPUT: 参数缺失或包含未声明字段；会话及用户确认不能由模型参数指定。');
      }
      const result = await this.handler(context.conversationId, value);
      return { name: this.spec.name, success: true, content: JSON.stringify(result) };
    } catch (error) {
      return { name: this.spec.name, success: false, content: error instanceof Error ? error.message : 'LEARNING_FAILED: 处理失败。' };
    }
  }
}

export function createLearningTools(planner: LearningPlanner): AgentTool[] {
  const text = { type: 'string', minLength: 1, maxLength: 500 };
  const timestamp = { type: 'string', description: 'ISO 8601 时间戳，必须含 Z 或 +08:00 等明确时区偏移。' };
  return [
    new LearningTool('get_learning_state', '读取当前会话的用户条件、路径、任务与计划；不执行日历写入。', {}, [],
      async (id) => planner.getState(id)),
    new LearningTool('explore_learning_directions', '分轮补充考研/就业访谈条件。缺项时询问缺项，齐全后展示两条路径、理由和体验任务；请用户选择。',
      { track: { type: 'string', enum: ['employment', 'postgraduate'] }, major: text, grade: text,
        background: text, interests: text, goal: text, weeks: { type: 'integer', minimum: 2, maximum: 4 },
        minutesPerWeek: { type: 'integer', minimum: 30, maximum: 10080 } }, [],
      async (id, input) => planner.interview(id, input)),
    new LearningTool('select_learning_path', '仅在用户明确选择候选方向后保存 pathId，不替用户擅自选择。',
      { pathId: text }, ['pathId'], async (id, input) => planner.selectPath(id, input.pathId!)),
    new LearningTool('create_learning_plan', '首次创建用户已选路径的2–4周计划时提供具体任务草案；每周不得超预算，前置任务须先列出。已有计划请读取并调整进度或排期。',
      { startAt: timestamp, tasks: { type: 'array', minItems: 2, maxItems: 16, items: { type: 'object',
        properties: { id: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,39}$' },
          title: { type: 'string', minLength: 1, maxLength: 120 },
          phase: { type: 'string', minLength: 1, maxLength: 60 },
          week: { type: 'integer', minimum: 1, maximum: 4 }, estimatedMinutes: { type: 'integer', minimum: 1, maximum: 10080 },
          completionCriteria: { type: 'string', minLength: 1, maxLength: 300 },
          dependsOn: { type: 'array', items: { type: 'string' }, description: '填写在本数组前面已列出的前置任务 id。' },
          dueAt: timestamp },
        required: ['id', 'title', 'phase', 'week', 'estimatedMinutes', 'completionCriteria', 'dependsOn'],
        additionalProperties: false } } }, ['startAt'],
      async (id, input) => planner.createPlan(id, input.startAt!, input.tasks)),
    new LearningTool('schedule_learning_tasks', '使用用户给定空闲时段，结合获授权读取的冲突、依赖与截止时间细化未来7天。容量不足时返回 status=partial，说明未排完任务，已有时段仍可预览。',
      { from: timestamp, available: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object',
        properties: { startAt: timestamp, endAt: timestamp }, required: ['startAt', 'endAt'], additionalProperties: false } },
      reminderMinutes: { type: 'integer', minimum: 0, maximum: 10080 } }, ['from', 'available'],
      async (id, input) => {
        if (!Array.isArray(input.available) || input.available.length < 1 || input.available.length > 100 ||
          input.available.some((slot) => slot === null || typeof slot !== 'object' ||
            Object.keys(slot).some((key) => !['startAt', 'endAt'].includes(key)))) {
          throw new Error('INVALID_TIME_WINDOW: 请提供1–100个仅含startAt/endAt的可用时段。');
        }
        return planner.schedule(id, input.from!, input.available, input.reminderMinutes);
      }),
    new LearningTool('preview_learning_calendar', '生成新增、修改或删除日程的预览；必须让用户在界面确认。此工具不会执行日历写入。',
      {}, [], async (id) => planner.previewCalendar(id)),
    new LearningTool('record_learning_progress', '仅按用户反馈记录任务完成或未完成及剩余耗时，保留稳定ID；随后重新排期和预览确认，不能自动修改设备日历。',
      { taskId: text, status: { type: 'string', enum: ['done', 'pending'] }, remainingMinutes: { type: 'integer', minimum: 1, maximum: 43200 } },
      ['taskId', 'status'], async (id, input) => planner.recordProgress(id, input.taskId!, input.status!, input.remainingMinutes)),
    new LearningTool('update_learning_task_constraints', '按用户要求调整未完成任务的截止时间或前置依赖；调整后须重新排期和预览，不自动修改设备日历。',
      { taskId: text, dueAt: { type: 'string', description: '带时区的截止时间，空串表示清除截止时间。' },
        dependsOn: { type: 'array', items: { type: 'string' } } }, ['taskId'], async (id, input) => {
        const patch: { dueAt?: string; dependsOn?: string[] } = {};
        if (input.dueAt !== undefined) { patch.dueAt = input.dueAt; }
        if (input.dependsOn !== undefined) { patch.dependsOn = input.dependsOn; }
        return planner.updateTaskConstraints(id, input.taskId!, patch);
      })
  ];
}
