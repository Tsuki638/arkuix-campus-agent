# A：学习方向与行动规划 Agent 实现与交接

## 产品依据与本次范围

对齐 GitHub `main` 的 `53b78c2`：考研/就业访谈 → 用户选择路径 → 两到四周阶段任务 → 一周排期 → 日历预览确认 → 进度反馈与调整。保留上一轮 `StudyPlanTool` 和短期时间分配能力。

参考 [LangGraph.js](https://github.com/langchain-ai/langgraphjs) 的有状态工具编排思路，使用本项目现有轻量 Agent，不引入外部依赖。

本轮实现 A 的共享业务、可注入业务仓库与日历端口。真实模型由 C 接入，方向选择/计划书/周日程/确认界面由 B 接入，设备日历权限与执行由 D 适配。离线模型和内存日历演示不计入真实云调用或双端日历验收。

## 实现文件与职责

| 文件 | 职责 |
| --- | --- |
| `agent/AgentEngine.ts`、`ToolRegistry.ts` | 注入当前会话及已保存状态，模型不能通过参数选择其他会话；保留步数、失败和并发保护 |
| `agent/learning/LearningCatalog.ts` | 识别访谈缺项、两个入口的候选与理由、短期体验任务、稳定阶段任务 |
| `agent/learning/LearningScheduler.ts` | 明确时区的一周排期、时段合并、日历冲突扣除、任务依赖/截止时间、未排与延期诊断 |
| `agent/learning/LearningPlanner.ts` | 业务版本、路径选择、进度、预览、可信确认/取消、逐项日历结果与恢复 |
| `agent/learning/LearningTools.ts` | 向模型声明学习工具，校验 JSON 字段并使用 Engine 提供的会话上下文 |
| `contracts/LearningModels.ts`、`LearningPorts.ts` | B/C/D 共用数据与仓库/日历契约 |
| `services/storage/JsonLearningRepository.ts` | 版本化 JSON、串行写快照、损坏拒绝覆盖、预览与计划/日程关联语义校验 |
| `platform/calendar/UnavailableCalendarPort.ts` | 未接设备时明确不可用，不伪造写入成功 |

所有源码相对 `app/entry/src/main/ets/`。测试位于 `tests/learning-*.test.mjs`，旧工具回归保留在 `tests/framework.test.mjs`。

## 访谈、路径与任务

访谈字段为 `track`（`employment` / `postgraduate`）、`major`、`grade`、`background`、`interests`、`goal`、`weeks`（2–4）、`minutesPerWeek`（30–10080 整数分钟）。范围仅用于校验，不是建议学习强度。可分轮补充，不清空已确认字段。

条件不足返回缺项；齐全后给两条候选、比较理由、体验任务和限制说明。用户选择后才能生成正式计划。计算机就业入口含 `go-backend` / `frontend`；其他专业提供通用能力与方向体验；考研提供通用学习基础或目标核实路径，不宣称具体院校招生科目或年份要求。尚不确定目标时，用户可明确填写“尚未确定”，先比较体验任务。

当前任务为可调整的模板提案，每周含学习与实践两项，周耗时按用户预算分配，每项包含稳定 ID、阶段、周次、预计/剩余分钟数、前置依赖、完成标准与状态。**耗时是提案估计，不保证掌握程度或岗位适配。**首条完整演示为 Go 后端方向；模板内容深度可由团队后续完善。

## 排期与反馈

`schedule` 使用未来七天窗口，按用户明确提供的空闲时段排期，允许长任务跨时段拆分。重叠空闲时段先合并，避免重复计算容量；忙碌区间扣除，带秒的忙区间向外取整占用分钟。输入必须包含 `Z` 或 `+08:00` 等时区，拒绝不存在的日期。

任务依赖按拓扑顺序处理，前置未完整排完时不提前安排后继；已完成任务不重排；窗口外阶段列为延期，容量/截止时间不足的当前任务列为未排，不能塞进超额时间。当前为顺序贪心排期，不承诺全局最优。任务、计划页与日历预览使用同一份任务数据。

用户反馈 `done` 或 `pending`，可补充剩余分钟数。反馈后旧预览失效，保留已完成任务并显式重排待办。`updateTaskConstraints` 可调整未完成任务的截止时间或依赖；循环/未知依赖不保存。再次生成同一路径计划也保留已反馈的进度和任务 ID。

## 模型工具与可信界面动作

模型可调用：

| 名称 | 作用 |
| --- | --- |
| `get_learning_state` | 读取本会话最新业务状态 |
| `explore_learning_directions` | 分轮访谈与候选路径 |
| `select_learning_path` | 保存用户已选候选 |
| `create_learning_plan` | 生成阶段任务提案 |
| `schedule_learning_tasks` | 一周具体排期 |
| `preview_learning_calendar` | 形成待确认动作列表，不写入 |
| `record_learning_progress` | 按用户反馈记录进度 |
| `update_learning_task_constraints` | 调整未完成任务的截止时间/依赖 |

短期目标仍可调用 `create_study_plan`。工具 schema 随模型请求提供，C 不应另手写一份。业务工具不能接受 `conversationId` 或 `confirmed`；Engine 从实际会话注入上下文。

B 使用以下可信入口，**不要把 confirm/cancel 注册成模型工具**：

```typescript
const preview = await runtime.learning.previewCalendar(conversationId);
// 展示 preview.operations 的日期、起止时间、提醒、create/update/delete 与时区。
// 仅在用户点击确认后：
const result = await runtime.learning.confirmCalendar(conversationId, preview.id);
// 用户点击取消时：
await runtime.learning.cancelCalendar(conversationId, preview.id);
```

确认绑定会话、`previewId`、业务 revision 与 planVersion。计划、时段、提醒或进度变更后旧预览失效；放置至日程已过时的预览也不能写。模型声称“已确认”无法通过这个门槛。

## 日历执行与异常恢复

1. 先持久保存预览与操作键，确认后每项先 `reconcile`。
2. 已成功项直接跳过；确定未执行项才 `apply`。执行意图先保存为 unknown，再执行并保存逐项结果与系统 ID。
3. 超时/抛错/无效回执记为 unknown。写成功但本地保存失败时，重启后通过同一个 operationKey 核对，不盲目再次创建。
4. 部分失败保留应用内计划和成功项，可按同一预览重试未完成项。
5. unknown 未核对前阻止修改/删除业务数据。用户取消时持久化取消意图，之后只核对、不补写；结果仍不明时保留记录，恢复后再次取消以核对。
6. 仅操作保存且经平台再次核验的本应用日程。已完成关联及过去日程不更新/删除；未来重新安排任务需要新建时使用新的关联键。
7. 同一会话的 send/delete 协调，删除与确认/业务修改共用规划锁。聊天删除失败不清空业务；业务删除失败则尝试恢复聊天，补偿失败明确返回恢复需求。删除本地会话不自动删除设备日历。

日历读取未授权或不可用时，仍可按用户空闲时段规划。获授权读取后，D 应为本应用事件返回 `eventId` / `appEventKey`，A 仅排除可核验且待替换的旧关联；相同时段的外部事件和无标识事件始终保留为冲突，避免本应用日程自我挤占或误忽略外部冲突。

## C/D 注入与持久化

`AppRuntime` 的前四个构造参数不变，第五/六个可注入 `LearningRepository` / `CalendarPort`；未提供日历时使用明确不可用实现。`createDeviceRuntime(context, settings, speech, calendar)` 已预留 D 的入口。

设备业务文件为 `context.filesDir/campus_agent_learning_v1.json`，与聊天文件分开，防止聊天快照覆盖刚保存的日历结果。当前记录 profile、候选与选择、当前计划版本、任务进度、预览/取消意图、逐项执行状态和关联 ID。C 可以替换业务仓库，但需保留快照、串行写、损坏拒绝覆盖及错误传播语义；此处“重启恢复”指仓库重建的 Node 检查，设备文件 API 仍需实测。

D 的 `CalendarPort`：

- `readBusy(startAt,endAt)`：返回是否可读、忙碌时段与原因；可给本应用项附带可核验 ID。
- `reconcile(operation)`：`succeeded` 为已核对执行成功，`failed` 为已确定未执行，`unknown` 为仍不明确；不可把“查询失败/超时”当作未执行。
- `apply(operation)`：按 operationKey 幂等执行 create/update/delete，再次验证归属；返回实际系统 ID 和逐项结果。`failed` 必须表示确定未执行，超时应为 unknown。

## 运行和真实联调

```powershell
npm.cmd run check
npm.cmd run demo
npm.cmd run demo:study
```

主演示使用明确标记的 JSON 模拟模型与内存日历，展示访谈、选择、计划、确认前零写入、部分失败重试、进度调整；旧四轮短期规划使用 `demo:study`。

离线工具输入示例：

```json
{"tool":"explore_learning_directions","input":{"track":"employment","major":"计算机","grade":"大三"}}
```

```json
{"tool":"explore_learning_directions","input":{"background":"学过Go基础","interests":"后端","goal":"体验实习方向","weeks":2,"minutesPerWeek":120}}
```

真实模型接入后，用自然语言完成同一链路，并在 B 的界面确认后由 D 的双端适配执行。录制材料需展示真实调用、实际系统日历和权限失败；Node 模拟日志不作为这部分验收。

本轮最终验证：19 个共享模块转换与导入通过，106 项行为检查全部通过；新版11步离线演示与旧短期演示均通过。日志位于被 Git 忽略的 `.generated/learning-direction-check.log`、`.generated/learning-direction-demo.log`、`.generated/learning-study-demo.log`，可按上述命令重建。
