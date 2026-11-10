import type { AgentTool } from '../../contracts/Ports';
import type { ToolDefinition, ToolResult } from '../../contracts/Models';
import { newId } from '../../contracts/Models';
import type { PlanTask, PlanVersion } from '../../services/storage/StudyDataRepository';
import { StudyDataRepository } from '../../services/storage/StudyDataRepository';

interface StudyTask {
  name: string;
  minutes: number;
}

interface StudyPlanInput {
  goal: string;
  days: number;
  minutesPerDay: number;
  tasks: StudyTask[];
}

// 约束排期返回文本。应用运行时也保留可存入计划页的基础安排。
export class StudyPlanTool implements AgentTool {
  private study: StudyDataRepository | undefined;

  constructor(study?: StudyDataRepository) { this.study = study; }

  definition(): ToolDefinition {
    return {
      name: 'create_study_plan',
      description: '按用户给定顺序和预计耗时分配学习任务，允许任务跨天拆分。' +
        '按分钟排期须先确认目标、天数、每日可用分钟数和任务耗时。时间不足时返回缺口。' +
        (this.study === undefined ? '' : '只需基础安排时可仅提供目标和天数，将保存到应用内计划列表。'),
      parametersJson: '{"type":"object","properties":{"goal":{"type":"string","minLength":1,"maxLength":200},' +
        '"days":{"type":"integer","minimum":1,"maximum":30},' +
        '"minutesPerDay":{"type":"integer","minimum":1,"maximum":1440},' +
        '"tasks":{"type":"array","minItems":1,"maxItems":50,"items":{"type":"object",' +
        '"properties":{"name":{"type":"string","minLength":1,"maxLength":100},' +
        '"minutes":{"type":"integer","minimum":1,"maximum":43200}},' +
        '"required":["name","minutes"],"additionalProperties":false}}},' +
        '"required":' + (this.study === undefined ? '["goal","days","minutesPerDay","tasks"]' :
          '["goal","days"]') + ',"additionalProperties":false}'
    };
  }

  async execute(input: string): Promise<ToolResult> {
    let value: StudyPlanInput;
    try {
      value = JSON.parse(input) as StudyPlanInput;
    } catch {
      return this.failure('INVALID_INPUT: 参数必须是 JSON 对象。');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      !this.onlyKeys(value, ['goal', 'days', 'minutesPerDay', 'tasks'])) {
      return this.failure('INVALID_INPUT: 仅接受 goal、days、minutesPerDay、tasks 字段的 JSON 对象。');
    }
    if (this.study !== undefined && value.minutesPerDay === undefined && value.tasks === undefined &&
      typeof value.goal === 'string' && value.goal.trim().length > 0 && Array.from(value.goal).length <= 200 &&
      Number.isInteger(value.days) && value.days >= 1 && value.days <= 30) {
      return this.saveBasicPlan(this.study, value.goal.trim(), value.days);
    }
    const missing: string[] = [];
    if (value.goal === undefined) { missing.push('学习目标 goal'); }
    if (value.days === undefined) { missing.push('可用天数 days'); }
    if (value.minutesPerDay === undefined) { missing.push('每天可用分钟数 minutesPerDay'); }
    if (value.tasks === undefined) { missing.push('任务列表 tasks（每项含 name 和预计分钟数 minutes）'); }
    if (missing.length > 0) {
      return this.failure('MISSING_FIELDS: 请补充：' + missing.join('、') + '。');
    }
    if (typeof value.goal !== 'string' || value.goal.trim().length === 0 || Array.from(value.goal).length > 200 ||
      !Number.isInteger(value.days) || value.days < 1 || value.days > 30 ||
      !Number.isInteger(value.minutesPerDay) || value.minutesPerDay < 1 || value.minutesPerDay > 1440 ||
      !Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > 50) {
      return this.failure('INVALID_INPUT: goal 为 1–200 字；days 为 1–30 整数；' +
        'minutesPerDay 为 1–1440 整数；tasks 须为 1–50 项任务。');
    }
    for (const task of value.tasks) {
      if (task === null || typeof task !== 'object' || Array.isArray(task) ||
        !this.onlyKeys(task, ['name', 'minutes']) || typeof task.name !== 'string' ||
        task.name.trim().length === 0 || Array.from(task.name).length > 100 ||
        !Number.isInteger(task.minutes) || task.minutes < 1 || task.minutes > 43200) {
        return this.failure('INVALID_INPUT: 每项任务仅含 name（1–100 字）和 minutes（1–43200 整数）。');
      }
    }
    const capacity: number = value.days * value.minutesPerDay;
    const total: number = value.tasks.reduce((sum: number, task: StudyTask) => sum + task.minutes, 0);
    if (total > capacity) {
      return this.failure('INSUFFICIENT_TIME: 任务预计需要 ' + total + ' 分钟，可用 ' + capacity +
        ' 分钟，缺少 ' + (total - capacity) + ' 分钟。请增加天数或每日可用时间，或减少任务；当前未生成完整计划。');
    }
    const lines: string[] = ['学习目标：' + value.goal.trim(),
      '可用时间：' + value.days + ' 天 × 每天 ' + value.minutesPerDay + ' 分钟 = ' + capacity + ' 分钟',
      '预计任务总时长：' + total + ' 分钟（按用户提供的估计）'];
    let taskIndex: number = 0;
    let remaining: number = value.tasks[0].minutes;
    for (let day: number = 1; day <= value.days; day += 1) {
      let used: number = 0;
      const parts: string[] = [];
      while (used < value.minutesPerDay && taskIndex < value.tasks.length) {
        const minutes: number = Math.min(remaining, value.minutesPerDay - used);
        parts.push(value.tasks[taskIndex].name.trim() + ' ' + minutes + ' 分钟');
        used += minutes;
        remaining -= minutes;
        if (remaining === 0) {
          taskIndex += 1;
          if (taskIndex < value.tasks.length) { remaining = value.tasks[taskIndex].minutes; }
        }
      }
      lines.push('第 ' + day + ' 天（' + used + '/' + value.minutesPerDay + ' 分钟）：' +
        (parts.length > 0 ? parts.join('；') : '未安排任务'));
    }
    lines.push('剩余可用时间：' + (capacity - total) + ' 分钟。任务允许跨天拆分；实际进度变化后请调整估计。');
    return { name: 'create_study_plan', success: true, content: lines.join('\n') };
  }

  private onlyKeys(value: Object, allowed: string[]): boolean {
    return Object.keys(value).every((key: string) => allowed.indexOf(key) >= 0);
  }

  private async saveBasicPlan(study: StudyDataRepository, goal: string, days: number): Promise<ToolResult> {
    const lines: string[] = ['学习目标：' + goal];
    const tasks: PlanTask[] = [];
    for (let day: number = 1; day <= days; day += 1) {
      const title: string = goal + '，完成第 ' + day + '/' + days + ' 部分，练习并记录疑问。';
      tasks.push({ id: newId('task'), title: title, day: day, status: 'pending' });
      lines.push('第 ' + day + ' 天：' + title);
    }
    const plan: PlanVersion = {
      id: newId('plan'), createdAt: Date.now(),
      conditions: { goal: goal, dailyMinutes: 0, startDate: '' }, tasks: tasks
    };
    try {
      await study.addPlan(plan);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('STORAGE_CORRUPT:')) {
        return this.failure('STORAGE_CORRUPT: 学习数据无法读取，请先备份原文件。');
      }
      return this.failure('STUDY_SAVE_FAILED: 学习计划未保存，请检查存储后重试。');
    }
    lines.push('已保存到应用内学习计划，可查看和标记完成；尚未安排具体时间或写入日历。');
    return { name: 'create_study_plan', success: true, content: lines.join('\n') };
  }

  private failure(content: string): ToolResult {
    return { name: 'create_study_plan', success: false, content: content };
  }
}
