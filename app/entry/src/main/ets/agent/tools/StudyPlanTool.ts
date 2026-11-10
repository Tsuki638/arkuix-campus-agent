import type { AgentTool } from '../../contracts/Ports';
import type { ToolDefinition, ToolResult } from '../../contracts/Models';
import { newId } from '../../contracts/Models';
import type { PlanTask, PlanVersion } from '../../services/storage/StudyDataRepository';
import { StudyDataRepository } from '../../services/storage/StudyDataRepository';

interface StudyPlanInput {
  goal: string;
  days: number;
}

// 生成基础安排；注入仓库后同时保存供计划页回看，不写系统日历。
export class StudyPlanTool implements AgentTool {
  private study: StudyDataRepository | undefined;

  constructor(study?: StudyDataRepository) { this.study = study; }

  definition(): ToolDefinition {
    return {
      name: 'create_study_plan',
      description: '根据学习目标和可用天数生成基础学习安排，并保存到应用内计划列表。' +
        '缺少目标或天数时先澄清；不创建系统日历或提醒。',
      parametersJson: '{"type":"object","properties":{"goal":{"type":"string"},' +
        '"days":{"type":"integer","minimum":1,"maximum":30}},' +
        '"required":["goal","days"],"additionalProperties":false}'
    };
  }

  async execute(input: string): Promise<ToolResult> {
    let value: StudyPlanInput;
    try {
      value = JSON.parse(input) as StudyPlanInput;
    } catch {
      return { name: 'create_study_plan', success: false, content: 'INVALID_INPUT: 参数必须是 JSON。' };
    }
    if (value === null || typeof value.goal !== 'string' || value.goal.trim().length === 0 ||
      value.goal.length > 200 || typeof value.days !== 'number' ||
      !Number.isInteger(value.days) || value.days < 1 || value.days > 30) {
      return { name: 'create_study_plan', success: false,
        content: 'INVALID_INPUT: goal 为 1–200 字的目标，days 为 1–30 的整数。' };
    }
    const lines: string[] = ['学习目标：' + value.goal.trim()];
    const tasks: PlanTask[] = [];
    for (let day: number = 1; day <= value.days; day += 1) {
      tasks.push({ id: newId('task'), title: value.goal.trim() + '，完成第 ' + day + '/' +
        value.days + ' 部分，练习并记录疑问。', day: day, status: 'pending' });
      lines.push('第 ' + day + ' 天：' + value.goal.trim() + '，完成第 ' + day + '/' +
        value.days + ' 部分，练习并记录疑问。');
    }
    if (this.study !== undefined) {
      const plan: PlanVersion = {
        id: newId('plan'), createdAt: Date.now(),
        conditions: { goal: value.goal.trim(), dailyMinutes: 0, startDate: '' }, tasks: tasks
      };
      await this.study.addPlan(plan);
      lines.push('已保存到应用内学习计划，可查看和标记完成；尚未安排具体时间或写入日历。');
    }
    return { name: 'create_study_plan', success: true, content: lines.join('\n') };
  }
}
