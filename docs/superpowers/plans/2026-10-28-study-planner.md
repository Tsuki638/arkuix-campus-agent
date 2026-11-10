# 学习任务规划 Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在用户选定的学习任务规划场景中，交付可按时间约束计算、澄清和修改的 Agent。

**Architecture:** 保留 Agent 执行循环与公共端口；StudyPlanTool 负责确定性校验与顺序分配，ModelClient 负责提取和澄清。离线模型合并同一会话的分轮 JSON 参数，实际自然语言能力留给真实模型联调。

**Tech Stack:** 现有 TypeScript、Node.js 内置测试，无新增依赖。

**Spec:** [Agent学习规划说明](../../Agent学习规划说明.md)

## Global Constraints

- 工作目录和分支沿用用户已选定的 `arkuix-campus-agent` / `feat/agent`。
- 公共 AgentService、ModelClient、ToolResult、SessionRepository 接口保持不变。
- `days` 为 1–30、`minutesPerDay` 为 1–1440 的整数，任务 1–50 项，按输入顺序允许跨天拆分。
- 先测试后实现；Node 检查不能代替 ArkTS 静态检查、云调用或设备验收。
- 本轮交付文件修改和验证结果，不代替用户提交或推送分支。

## Review Focus

- 数组、null、错误类型、额外字段不能穿过工具的实际校验。
- 跨天任务的分配分钟数准确；空闲天不生成虚构任务。
- 多轮补充或修改必须保留其余条件，不同会话不共享参数。
- 时间不足后模型声称成功时仍返回真实失败；修正成功后能恢复。
- 保留调用 ID 配对、执行上限、并发保护与存储失败语义。

## Task 1: 约束规划工具

**Files:** 修改 `agent/tools/StudyPlanTool.ts`、`tests/framework.test.mjs`。

**Interfaces:** 消费 `AgentTool.execute(input: string)`；产出原有 `{ name, success, content }`，其中 content 为可读计划或明确错误。

- [x] 更新原有合法工具输入；新增 270 分钟跨天分配、空闲天、时间不足、缺字段、错误类型及额外字段测试。
- [x] 运行 `npm.cmd test`，确认新增行为在旧实现上失败。
- [x] 实现严格校验、顺序跨天分配和容量不足反馈；运行测试确认工具用例通过。

## Task 2: 多轮流程、演示与交接

**Files:** 修改 `agent/AgentEngine.ts`、`services/model/MockModelClient.ts`、`scripts/demo.mjs`、相关说明。

**Interfaces:** 消费 Task 1 的工具 schema 和结果；产出原有 `AgentService.send` 状态、历史与答复。

- [x] 新增分轮补充、修改与会话隔离、工具失败被模型误报成功、工具修正恢复、非 Error 模型异常测试。
- [x] 运行 `npm.cmd test`，确认新行为失败。
- [x] 完善提示词和最终失败保护；离线模型合并历史用户 JSON 参数，保留旧格式用于预填目标和天数。
- [x] 更新演示：澄清 → 成功计划 → 时间不足 → 调整后恢复。
- [x] 更新工具输入说明和真实模型联调脚本；运行 `npm.cmd run check`、`npm.cmd run demo` 和 diff 检查。
- [x] 请求一次只读代码审查，处理重要问题，记录云端与设备验证边界。

## 验证记录

- `npm.cmd run check`：26 项通过，0 失败；共享源码 11 个模块完成转换与导入检查。
- `npm.cmd run demo`：四轮澄清、成功、时间不足、修改恢复均符合预期；14 条历史消息。
- `git diff --check`：通过。
- 独立审查发现无关工具成功可能覆盖规划失败，已复现并改为按工具名跟踪错误；另统一 Unicode 字符长度与 schema，并补充回归用例。
- 本机日志在忽略目录 `.generated/agent-check.log` 和 `.generated/agent-demo.log`，可由上述命令重新生成。
- 尚未验证真实云模型、DevEco/ArkTS 编译或鸿蒙/Android 设备运行。
