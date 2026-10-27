import type { AgentTool } from '../contracts/Ports';
import type { ToolDefinition, ToolResult } from '../contracts/Models';

export class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    const name: string = tool.definition().name;
    if (this.tools.has(name)) {
      throw new Error('DUPLICATE_TOOL: 工具已注册：' + name);
    }
    this.tools.set(name, tool);
  }

  definitions(): ToolDefinition[] {
    const result: ToolDefinition[] = [];
    this.tools.forEach((tool: AgentTool) => { result.push(tool.definition()); });
    return result;
  }

  async execute(name: string, input: string): Promise<ToolResult> {
    const tool: AgentTool | undefined = this.tools.get(name);
    if (tool === undefined) {
      return { name: name, success: false, content: 'UNKNOWN_TOOL: 未注册的工具，请使用已声明的工具。' };
    }
    try {
      return await tool.execute(input);
    } catch {
      return { name: name, success: false, content: 'TOOL_FAILED: 工具执行失败，请检查参数或向用户澄清。' };
    }
  }
}
