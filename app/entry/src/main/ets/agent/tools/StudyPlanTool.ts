import type { AgentTool } from '../../contracts/Ports';
import type { ToolDefinition, ToolResult } from '../../contracts/Models';

interface StudyPlanInput {
  goal: string;
  days: number;
}

// 无外部副作用的最小工具示例。正式选题确定后可替换，不改变 UI/模型接口。
export class StudyPlanTool implements AgentTool {
  definition(): ToolDefinition {
    return {
      name: 'create_study_plan',
      description: '根据学习目标和可用天数生成基础学习安排。缺少目标或天数时先向用户澄清。',
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
    for (let day: number = 1; day <= value.days; day += 1) {
      lines.push('第 ' + day + ' 天：' + value.goal.trim() + '，完成第 ' + day + '/' +
        value.days + ' 部分，练习并记录疑问。');
    }
    return { name: 'create_study_plan', success: true, content: lines.join('\n') };
  }
}
