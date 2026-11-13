# A：学习方向与行动规划 Agent 实现与交接

## 产品依据与本次范围

沿用考研与就业访谈、路径选择、两到四周阶段任务、周排期、日历确认及进度调整。当前分支已接入 GitHub [新版工作台、DeepSeek 与鸿蒙日历草案](https://github.com/Tsuki638/arkuix-campus-agent/pull/3)。

参考 [LangGraph.js](https://github.com/langchain-ai/langgraphjs) 的有状态工具编排思路，使用本项目现有轻量 Agent，不引入外部依赖。

方向选择可在对话中完成。工作台的“学习计划”显示当前对话的阶段任务、完成标准与已排时段，可逐项标记完成或撤销。“日程预览”显示日期、起止时间、提醒、待确认变更与逐项结果。

## 实现文件与职责

| 文件 | 职责 |
| --- | --- |
| `agent/AgentEngine.ts`、`ToolRegistry.ts` | 注入当前会话及已保存状态，模型不能通过参数选择其他会话；保留步数、失败和并发保护 |
| `agent/learning/LearningCatalog.ts` | 识别访谈缺项、候选理由与体验任务、校验模型任务草案 |
| `agent/learning/LearningScheduler.ts` | 明确时区的一周排期、时段合并、日历冲突扣除、任务依赖/截止时间、未排与延期诊断 |
| `agent/learning/LearningPlanner.ts` | 业务版本、路径选择、进度、预览、可信确认/取消、逐项日历结果与恢复 |
| `agent/learning/LearningTools.ts` | 向模型声明学习工具，校验 JSON 字段并使用 Engine 提供的会话上下文 |
| `contracts/LearningModels.ts`、`LearningPorts.ts` | B/C/D 共用数据与仓库/日历契约 |
| `services/storage/JsonLearningRepository.ts` | 版本化 JSON、串行写快照、损坏拒绝覆盖、预览与计划/日程关联语义校验 |
| `services/calendar/LearningCalendarAdapter.ts` | 复用设备日历服务，确认时申请权限，按稳定标识查证日程及恢复 |
| `platform/calendar/UnavailableCalendarPort.ts` | 未接设备时明确不可用，不伪造写入成功 |

所有源码相对 `app/entry/src/main/ets/`。测试位于 `tests/learning-*.test.mjs`，旧工具回归保留在 `tests/framework.test.mjs`。

## 访谈、路径与任务

访谈字段为 `track`（`employment` / `postgraduate`）、`major`、`grade`、`background`、`interests`、`goal`、`weeks`（2–4）、`minutesPerWeek`（30–10080 整数分钟）。范围仅用于校验，不是建议学习强度。可分轮补充，不清空已确认字段。

条件不足返回缺项；齐全后给两条候选、比较理由、体验任务和限制说明。用户选择后才能生成正式计划。计算机就业入口含 `go-backend` / `frontend`；其他专业提供通用能力与方向体验；考研提供通用学习基础或目标核实路径，不宣称具体院校招生科目或年份要求。尚不确定目标时，用户可明确填写“尚未确定”，先比较体验任务。

真实模型首次生成计划时可提交 `tasks`，每项包含简短 ID、标题、阶段、周次、预计分钟、完成标准、先列出的前置任务及可选截止时间。工具校验周预算、任务覆盖和依赖后才保存。省略草案可用内置模板演示。定制计划生成后沿用现有任务，进度调整通过专用工具执行。

## 排期与反馈

`schedule` 使用未来七天窗口，按用户明确提供的空闲时段排期，允许长任务跨时段拆分。重叠空闲时段先合并，避免重复计算容量；忙碌区间扣除，带秒的忙区间向外取整占用分钟。输入必须包含 `Z` 或 `+08:00` 等时区，拒绝不存在的日期。

任务依赖按拓扑顺序处理，前置未完整排完时不提前安排后继；已完成任务不重排；窗口外阶段列为延期，容量/截止时间不足的当前任务列为未排，不能塞进超额时间。当前为顺序贪心排期，不承诺全局最优。任务、计划页与日历预览使用同一份任务数据。

用户反馈 `done` 或 `pending`，可补充剩余分钟数。反馈后旧预览失效，保留已完成任务并显式重排待办。`updateTaskConstraints` 可调整未完成任务的截止时间或依赖；循环/未知依赖不保存。再次生成同一路径计划也保留已反馈的进度和任务 ID。

下调每周可用时间后，旧的待办排期失效。重新排期按最新预算截断可用时间，排不完的任务保留待办并返回 `partial`。

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

`AppRuntime` 的第五、六个构造参数用于注入 `LearningRepository` 和 `CalendarPort`。`createDeviceRuntime(context, settings, speech, calendar)` 接收平台 `CalendarService`，供原有日历草案和阶段排期共用。鸿蒙通过应用自己的“学习计划”账户执行；当前排期依据用户填写的空闲时段。

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

应用的“模型设置”可选 DeepSeek，使用自己的 API Key，进入考研准备或就业探索，再明确选择路径、填写未来七天可用时段并生成日程预览。设备验收需核对系统日历里的新增、移动、删除和提醒，以及拒绝权限时的界面反馈。

API 24 鸿蒙工程可构建未签名 HAP。当前设备环境没有可用的 DeepSeek 凭据，真实模型的阶段任务生成、设备端日历读写与提醒，以及 Android 日历仍待验收。
