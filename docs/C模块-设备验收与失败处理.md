# 成员 C 交付说明：模型、数据与失败反馈

> 对应 GitHub [#6 双端真实模型验收](https://github.com/Tsuki638/arkuix-campus-agent/issues/6)、
> [#7 双端会话持久化验收](https://github.com/Tsuki638/arkuix-campus-agent/issues/7)、
> [#11 汇总双端运行材料](https://github.com/Tsuki638/arkuix-campus-agent/issues/11)。
> 核查基线：main `6d4a292`（2026-11-11），队长的 #4 任务总览创建于 2026-11-13。
> **本文件严格区分「电脑 Node 侧已验证」与「设备端待验收」，前者不用于关闭设备验收项。**

## 一、本轮补齐了什么

main 上模型适配层、设备 HTTP 端口、会话/学习数据/日历仓库都已实现，但底层统一抛
`CODE: 中文说明` 格式的错误，界面（`ChatWorkspace.ets`、`CalendarDraftCard.ets`）直接把
`error.message` 原样显示。因此断网、无效密钥、超时、损坏文件时，用户看到的是
`MODEL_TIMEOUT: ...` 这类带英文码前缀的文本，且没有明确的「接下来怎么做」。这正对应
#6 的第 4 条和 #7 的第 4 条。

| 改动 | 文件 | 作用 |
| --- | --- | --- |
| 统一界面错误文案 | `services/model/ErrorText.ts`（新增） | `describeAgentError()` 把 41 个已登记错误码转成中文可操作提示；`errorCodeOf()` 保留错误码供日志/诊断；`needsModelSettings()` 判断是否需要引导去模型设置。 |
| 界面接入 | `ui/ChatWorkspace.ets`、`ui/CalendarDraftCard.ets` | 全部错误显示点改为走统一文案；模型类失败时错误区新增「检查模型设置」按钮；切换会话/发送时清空错误码。 |
| 失败后输入保留（4.3 设备实测发现） | `ui/ChatWorkspace.ets` | `submit()` 只在 `result.state === 'completed'` 时清空输入框，并在 `finally` 中把原文写回；断网 / 鉴权 / 超时失败时保留原输入可直接重发。 |
| 回归测试 | `tests/framework.test.mjs` | 新增 8 项：文案覆盖、密钥防泄漏、动态说明、错误码提取、**源码错误码完备性**、断网端到端、损坏数据端到端、**失败后输入保留的源码防回归**。 |

**安全边界**：未分类异常只返回场景化兜底文案，绝不把原始 `message` 显示出来；已知错误码的
补充说明也只在通过敏感串检查（`sk-` / `Bearer` / `Authorization` / `api_key` / `token` /
`<` / `{` / URL）且长度 ≤120 时才追加。这样设备 HTTP 端口或平台 API 抛出的响应体、鉴权头、
运行时密钥都不会出现在界面、会话历史或截图里。

**保持 / 修复原有行为**：模型失败时输入保留（本轮按 4.3 设备实测修复；原实现只在首次落盘抛异常时保留）、`busy` 在 finally 中复位、历史仓库损坏时拒绝
覆盖原文件、模型切换失败不破坏当前可用模型——这些都没有改动。

## 二、电脑上已验证（2026-11-13）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 共享模块导入 + 全部单测 | `npm run check` | **23 个模块**、**58 项用例全绿**（原 50 + 新增 8） |
| 离线演示 | `npm run demo` | 多轮、工具执行、计划保存、打卡均通过 |
| 真实模型工具闭环 | `node scripts/verify-model.mjs`（凭据从仓库外 `.secrets` 注入进程环境） | **通过**：`qwen-plus` 3 次 HTTP 请求，模型选择工具 → 执行并保存 3 天计划 → 回传结果 → 最终答复；第二轮记住科目与天数；序列化数据不含密钥 |
| 无效密钥失败链路 | 用 `sk-invalid-for-failure-check` 访问同一真实接口 | 底层 `MODEL_AUTH` → 界面「密钥可能无效或已过期，请到「模型设置」重新填写，或切回离线示例继续」→ 提示去设置 = true → 文案不含密钥 |

真实模型报告落在被 Git 忽略的 `.generated/model-verification.json`，只含脱敏状态、HTTP 状态、
消息数量与检查项，不含密钥或完整请求报文。

> 注意：电脑上的 `verify-model.mjs` 用 Node `fetch` 复刻 `JsonTransport`，**不等于**设备端
> `OhosJsonTransport` 的 HTTPS/权限行为。#6 #7 仍需按第四节在鸿蒙与 Android 真机各做一遍。

## 三、错误码 → 界面文案对照（节选）

完整映射以 `services/model/ErrorText.ts` 为准，`npm run check` 中的完备性测试会扫描源码里
所有 `new Error('CODE: ...')`，**新增错误码却没补文案会直接让检查失败**。

| 场景 | 底层错误码 | 界面显示（要点） |
| --- | --- | --- |
| 断网 / DNS | `MODEL_TRANSPORT` | 检查网络与网络权限后重试；离线计划与历史仍可查看 |
| 无效 / 过期密钥 | `MODEL_AUTH` | 到「模型设置」重新填写，或切回离线示例 |
| 请求超时 | `MODEL_TIMEOUT` | 检查网络后重新发送；输入仍保留 |
| 限流 / 服务不可用 | `MODEL_RATE_LIMIT` `MODEL_HTTP` | 稍后重试；账户余额不足等应用自身说明会追加 |
| 配置不完整 | `MODEL_CONFIG` | 补全 HTTPS 接口、模型名称、密钥 |
| 会话 / 学习 / 日历文件损坏 | `STORAGE_CORRUPT` `CALENDAR_STORAGE` | 已保留原始文件，先备份再处理，不要继续写入 |
| 麦克风被拒 | `SPEECH_PERMISSION_DENIED` | 可继续用文字输入 |
| 日历未授权 | `CALENDAR_PERMISSION` | 草案已保留，授权后回预览页重试 |
| 未分类异常 | 无 | 只显示场景化兜底，不透传原始内容 |

## 四、设备端待验收清单（#6 / #7，需要你或平台负责人操作）

环境搭建见[真机环境搭建指南](真机环境搭建指南.md)。以下每一项都要记录**设备型号、系统版本、
复现步骤、结果、脱敏截图/录屏**，并附实际源码提交；Node 检查不能代替。

### 4.0 鸿蒙真机已自动完成的部分（2026-11-15，命令行证据）

设备：**HUAWEI Mate 80 / VYG-AL00，HarmonyOS 7.0.0.109（API 26）**，UDID `6XE0225B18001474`。
工具链 API 24 编译、设备 API 26，签名后安装成功，代差不构成阻碍。

| # | 检查 | 命令 / 证据 | 结果 |
| --- | --- | --- | --- |
| #5 | 签名与安装 | 自动签名生成 `.cer/.csr/.p12/.p7b`；`ace build hap -r` → `entry-default-signed.hap`（800,642 B）；`hdc app install -r` → `install bundle successfully`；`bm dump -n` 有 `com.example.campusagent` | ✅ |
| #5 | 启动 | `aa start -a EntryAbility -b com.example.campusagent` → `start ability successfully`；hilog `appStartMonitor e2e:630ms`，无崩溃 | ✅ |
| #6-6 | 权限 | `bm dump` 列出 `ohos.permission.INTERNET / MICROPHONE / READ_CALENDAR / WRITE_CALENDAR` | ✅ 声明齐全 |
| #6-5 | **密钥不落盘** | 扫描整个 `/data/app/el2/100/base/com.example.campusagent`：`grep -rInE 'sk-\|Bearer \|Authorization\|api_key\|apiKey\|token\|dashscope'` 无命中；目录下只有 `campus_agent_sessions_v1.json` 一个文件。源码里 `ModelSettings.apiKey` 注释「仅运行时注入」，UI 文案「密钥仅在本次运行中使用，重启后需重新配置」 | ✅ 结构性保证 + 设备实测 |
| #7-2 | 存储路径/边界 | `FileKeyValueStore` 落盘在 `haps/entry/files/campus_agent_<key>.json`；源码 key 为 `sessions_v1`、`study_data_v1`，日历映射独立文件 | ✅ 三个 key 隔离 |
| #7-4 | **损坏文件保护** | force-stop → 写入损坏 JSON `{"version":1,"conversations":[BROKEN` → 重启应用 → 拉回文件逐字节比对 `ORIGINAL_CORRUPT_FILE_UNCHANGED=True`（原文件**未被覆盖**）→ 恢复原文件并重启 | ✅ 核心安全行为 |
| #7-1 | 会话文件可读性 | 拉回本地按 UTF-8 解析：`{"version":1,"conversations":[{...,"title":"新会话","messages":[]}]}`，JSON 有效（hdc shell 直接 `cat` 显示中文乱码只是终端编码，不是数据损坏） | ✅ |

> 上述是**设备端真实证据**，但只覆盖「安装 / 启动 / 权限 / 存储结构与异常保护 / 凭据不落盘」。
> 应用内交互见 4.1、工具闭环与重启持久化见 4.2、UI 回看与失败反馈（含一处缺陷修复及
> 一次构建缓存排查）见 4.3。鸿蒙侧仅剩**全量重编后「失败后输入保留」的一次 UI 复验**
> 与超时场景；Android 侧全部设备验收仍需队友；不能据此关闭 #6 / #7 整项。

### 4.1 鸿蒙真机 · 应用内交互验收（2026-11-15 14:46–14:48，命令行取证）

设备同上。用户在应用「模型设置」填入 DashScope 兼容接口并点「应用云端配置」：
`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`、`qwen-plus`，
密钥仅通过密码框在运行时注入。侧边栏底部显示「我的学习空间 / **云端模型 · 本地保存**」，
对话页模式标签为「云端模型」，说明配置已生效。

取证方式：命令行每 2 秒拉取 `haps/entry/files/campus_agent_sessions_v1.json`，
文件变化时保存快照，解析消息 role / 顺序 / `toolCalls`，并对敏感串做扫描；
三张脱敏界面截图归档为 `harmony-acceptance-1.jpg ~ 3.jpg`（均在仓库外证据目录）。
完整原始时间线见 `watch-report.txt`。

| 时间 | 文件大小 | 会话 | 变化 | 结论 |
| --- | --- | --- | --- | --- |
| 14:46:39 | 327 B | 1 个 / 1 条 | `user`「帮我做一份3天的高等数学复习计划」 | 用户输入先落盘，断网也能回看 |
| 14:46:47 | 1,352 B | 1 个 / 2 条 | `assistant` 真实模型答复（追问计划聚焦内容） | **设备侧 HTTPS 真实模型调用成功**（#6-2） |
| 14:47:07 | 1,516 B | 1 个 / 3 条 | `user`「刚才那份计划是什么科目，几天？」 | 第二轮发送 |
| 14:47:15 | 2,614 B | 1 个 / 4 条 | `assistant` 引用第一轮原文，明确「高等数学 × 3 天」，并说明尚未创建计划 | **多轮上下文由持久化历史重建成功**（#6-3 / #7 多轮落盘） |
| 14:48:08 | 126 B | 1 个 / 0 条「新会话」 | 用户点删除当前会话；`delete(id)` 后列表为空，应用自动 `createConversation()` | **删除会话生效**（#7-3 前半） |

- 每一次快照 `SECRET_SCAN=CLEAN`：文件内无 `sk-` / `Bearer` / `Authorization` / `api_key` /
  `token` 等串，与「运行时密钥不落盘」一致（#6-5 的凭据部分）。
- 每一次快照 `STUDY_DATA_FILE_ABSENT`，与模型仍处于「澄清待确认」阶段、侧边栏
  「学习计划 **0**」一致：模型两次答复的 `toolCalls=0`，**尚未产生工具调用**。
- 会话文件始终是可解析的 UTF-8 JSON，结构为 `{"version":1,"conversations":[...]}`，
  与 `JsonSessionRepository.read()` 的校验规则一致。

**本轮可确认**：#6-1/2/3（鸿蒙侧配置、真实答复、第二轮上下文）✅；
#7 多轮按序落盘 ✅、删除会话 ✅、密钥不落盘 ✅。

**4.1 当时仍待**：#6-4、#7-1、#7-3 已于 15:00–15:02 按 4.2 完成；
#6-5 失败文案、计划页 UI 回看截图与 Android 侧全部仍未覆盖。

**当时给用户的下一步**（已于 15:00 执行）：发一句「…直接创建计划不用再确认」，
让模型发起 `create_study_plan`，随后命令行 force-stop 重启并拉文件比对。

### 4.2 鸿蒙真机 · 工具闭环与重启持久化（2026-11-15 15:00–15:02）

用户在当前会话发送「帮我生成一份3天的高等数学复习计划，重点是函数与极限、导数与微分、
不定积分与定积分，直接创建计划不用再确认」。取证脚本与命令行结果：

| 时间 | 会话文件 | 变化 | 结论 |
| --- | --- | --- | --- |
| 15:00:24 | 462 B / 1 条 | `user` 消息先落盘 | 断网也能回看 |
| 15:00:27 | 1,761 B / 3 条 | `assistant` 发起 **`create_study_plan`**（`toolCalls=1`，入参 `{"days":3,"goal":"高等数学复习：…"}`）→ `tool` 结果 `success:true`（3 天任务） | **模型→工具→应用执行→结果回传闭环成立**（#6-4）；同时生成 `campus_agent_study_data_v1.json` 845 B |
| 15:00:32 | 2,875 B / 4 条 | `assistant` 最终答复「计划已成功创建并保存到应用内学习计划」，并明确尚未写入日历 | 工具结果被模型正确消费 |

- 学习数据文件为独立 key：`{"version":1,"plans":[{...,"tasks":[day1,day2,day3],"status":"pending"}],"records":[]}`，
  三个任务均为 `pending`、`records` 为空，符合「刚创建、未打卡」。会话与计划**分文件存储**。
- 两个文件独立扫描均无 `sk-` / `Bearer` / `Authorization` / `api_key` / `token` / `dashscope`。

**彻底退出进程后的重启验证**（`hdc` 命令行，非仅切后台）：

| 步骤 | 结果 |
| --- | --- |
| `pidof com.example.campusagent` | `13456` |
| `aa force-stop` → 再 `pidof` | 空，`PROCESS_TERMINATED=True` |
| `aa start -a EntryAbility -b com.example.campusagent` → `pidof` | `14482`（**新进程冷启动**，hilog `appStartMonitor e2e:630`、`app cold start finished`） |
| 会话文件重启前 → 后 | 2,875 B，SHA256 `C197CA85…32555A539041251DB3A2` **逐字节一致** |
| 学习数据文件重启前 → 后 | 845 B，SHA256 `AB213805…CD815E5BE44600D439BAEF3E71F7464CC2C2D18C472D57B` **逐字节一致** |
| 消息序列 | `user → assistant(toolCalls=1) → tool(toolCallId=call_1cc9ce255cb74c28a30ba3) → assistant`，顺序与工具配对不变 |
| 已删除会话 | 重启后文件仅有 1 个会话，`session-mwhghdc0-1-bnccwe` 不存在，`DELETED_SESSION_ABSENT=True` |

**结论**：#6-4 ✅（真实模型在设备端发起工具、应用执行并保存、结果回传、最终答复）；
#7-1 ✅（彻底退出进程后重启，历史内容与顺序完整）；
#7-3 ✅（删除会话不复活，学习计划与会话独立保留）；
#7-5 ✅（实测 `sessions_v1` / `study_data_v1` 两个独立文件）。
原始证据：`sessions-150024/150027/150032.json`、`study-now.json`、`restart-before/after.json`、
`restart-verify-sessions/study.json`、`watch-report.txt`（均在仓库外证据目录）。

> **注意**：重启后运行时密钥按设计丢失，若继续云端对话须重新在「模型设置」填入；
> 这同时再次印证 #6-5 的「密钥不落盘」。#6-4 的「计划页可回看」已有文件级证据，
> 建议再补一张应用内学习计划页的脱敏截图作为 UI 证据。

**4.2 当时仅剩的失败反馈与 UI 回看**已于 15:16–15:23 在 4.3 覆盖，并从中发现、
修复了一处「失败后输入被清空」缺陷。

### 4.3 鸿蒙真机 · 计划页 UI 回看、失败反馈与缺陷修复（2026-11-15 15:16–15:47）

三张脱敏截图归档为 `harmony-acceptance-4.jpg ~ 6.jpg`（仓库外证据目录）。

| 截图 | 设备画面 | 结论 |
| --- | --- | --- |
| 4 | 学习计划页：**1 学习计划 / 3 全部任务 / 0 已完成**，标题「高等数学复习：函数与极限、导数与微分、不定积分与定积分」，DAY 1–3 三个「待完成」任务，底部「准备日历日程」 | **#6-4 计划页可回看 ✅**，与 `study_data_v1.json` 的 3 个 `pending` 任务、`records:[]` 完全一致 |
| 5 | 状态栏飞行模式图标；红色错误卡片「**无法连接模型服务，请检查网络与网络权限后重试；离线计划与历史仍可查看。**」+「检查模型设置」按钮 | **#6-5 断网文案 ✅**，中文可操作、无 `MODEL_TRANSPORT` 英文码前缀、有设置入口 |
| 6 | 错误密钥场景；错误卡片「**模型鉴权失败，密钥可能无效或已过期。请到「模型设置」重新填写，或切回离线示例继续。**」+「检查模型设置」按钮 | **#6-5 鉴权失败文案 ✅** |

设备会话时间线另外证明：15:17:39 切回**离线示例**后发送「查看详细任务列表」，
得到离线模型第 2 轮正常答复 → 「切回离线示例仍可对话」✅；
15:18:59 / 15:19:34 两次云端失败时只有 `user` 消息落盘、没有伪造的 `assistant` 回复，
符合 `AgentEngine` 的失败语义。

**发现并修复的缺陷（本轮新增代码改动）**：`ChatWorkspace.submit()` 原在
`agent.send()` 返回后**无条件**执行 `this.input = ''`。模型失败由 `AgentEngine.send()`
内部捕获并以 `state:'failed'` 返回（不抛异常），因此断网 / 鉴权失败时输入框也被清空，
与验收清单「输入仍保留」以及 catch 分支兜底文案「刚才的输入仍保留」矛盾。
设备证据：15:18:59 与 15:19:34 出现两条内容完全相同的 `user` 消息
「查看第一天详细任务列表」（用户被迫重打），两张截图的输入框都是空 placeholder。

修复分两步，中间还排查出一次**构建缓存陷阱**：

1. `submit()` 改为只在 `result.state === 'completed'` 时清空输入，并在 `finally` 中
   `if (!succeeded) { this.input = text; }` 显式把原文写回，避免错误区重建过程中
   `TextArea` 丢内容；`tests/framework.test.mjs` 加源码结构防回归检查
   （submit 内只允许一处清空、必须受 `completed` 保护、失败路径必须写回原文）。
2. **15:23 首次重装实际没生效**。15:41 的复验截图（`harmony-acceptance-7.jpg`）
   输入框仍是空 placeholder，会话文件在 15:41:36 / 15:41:49 出现两条内容相同的
   「测试输入保留」（用户被迫重打）。排查发现 `ace build hap -r` 命中增量编译缓存：
   `entry/build/default/cache/.../esmodule/release/.../ChatWorkspace.ts` 仍是
   无条件 `this.input = ''` 的旧副本，HAP 内 `ets/modules.abc`（526,456 B）与之一致
   —— **源码改了，字节码没进包**。这是构建链问题，不是修复逻辑错误。
3. **15:47 全量重编**：删除整个 `app/entry/build` 后重新 `ace build hap -r`
   （`CompileArkTS` 24 s 336 ms，非 UP-TO-DATE），新生成的
   `esmodule/debug/.../ChatWorkspace.ts` 明确含条件清空与 `finally` 写回；
   `modules.abc` 526,544 B、签名 HAP 800,513 B，HAP 内 abc 与本地编译产物
   SHA-256 完全一致（`3eb015bf…a92e5e2d73`）。`hdc app install -r` →
   `install bundle successfully`，新 PID 56330，会话 3,891 B、学习数据 845 B
   （SHA 不变）完整保留。

| 检查 | 结果 |
| --- | --- |
| `npm run check` | **58/58 全绿**（原 57 + 新增 1） |
| 全量 `ace build hap -r` | `BUILD SUCCESSFUL in 50 s 828 ms`，`CompileArkTS` 24 s 336 ms，`SignHap` 通过 |
| 编译中间产物 | `ChatWorkspace.ts` 含 `if (result.state === 'completed')` 与 `finally` 写回 |
| HAP / abc | 800,513 B / 526,544 B，HAP 内 abc 与本地产物逐字节一致 |
| 安装与数据 | `INSTALL_EXIT=0`，新 PID 56330，会话与计划数据完整 |
| 仓库洁净度 | `app/build-profile.json5` 已 `git checkout --` 还原，签名配置不进提交 |

**待复验（第 2 次，30 秒）**：这次已确认字节码含修复。重新填一次云端配置
（任意错误密钥即可，不需要真实密钥）→ 发一句话 → 出现鉴权失败卡片时确认
**输入框仍保留这句话**。前两张复验截图来自未生效的包，不能作通过证据。
超时（弱网）场景本机未覆盖，建议报备队长由 Android 侧一并验证或用代理注入延迟。

**鸿蒙侧状态**：#6 的 1–4 项、第 5 项的断网/鉴权文案与离线回退、密钥不落盘 ✅；
第 5 项「输入保留」已全量重编并安装、**待 1 次 UI 复验**；#7 全部 ✅。
Android 侧全部验收仍需队友用已签名 `app-release.apk` 完成。

**在手机上填模型配置**（本机只有 DashScope 兼容密钥，没有 DeepSeek 官方密钥，
所以不要点面板里的「填入 DeepSeek 官方配置」；2026-11-15 已按此填完）：

```text
接口地址  https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
模型名称  qwen-plus
API Key   由本机操作者从仓库外的本地密钥文件（MODEL_API_KEY）读取
          （只填进应用密码框，不写进仓库、文档、日志或截图）
```

### #6 应用内真实模型调用（鸿蒙 + Android 各一遍）

> 进度（2026-11-15）：鸿蒙侧第 1–4 项已通过（含 4.3 的计划页 UI 回看）；第 5 项的
> 断网/鉴权文案、离线示例回退、密钥不落盘均已通过，「输入仍保留」发现缺陷并修复，
> 首次重装因增量编译缓存未生效，15:47 已全量重编并安装、**待 1 次 UI 复验**；
> 超时场景与 Android 侧全部仍待验收。

1. 应用内「模型设置」→ 填入 DeepSeek 官方配置或兼容接口 → 输入运行时密钥 → 应用云端配置。
2. 发一句自然语言，确认返回真实模型答复；记录模型 ID 与设备/系统版本。
3. 第二轮追问上一轮信息（如「刚才计划是什么科目、几天」），确认使用上文且不重复创建计划。
4. 验证真实模型发起工具请求 → 应用执行并保存 → 结果回传 → 最终答复 → 计划页可回看。
5. **失败反馈**（本轮补齐项，逐条核对）：
   - 开飞行模式后发送 → 显示「无法连接模型服务…」，出现「检查模型设置」按钮，输入仍保留，恢复网络后可继续发送；
   - 填一个错误密钥 → 显示鉴权失败提示，切回离线示例仍可对话；
   - 弱网/超时 → 显示超时提示，可重新发送；
   - 检查设备日志、会话历史、截图中**没有密钥**。
6. 核对设备侧 HTTPS 请求、`INTERNET` 权限与鉴权头；若适配层报错，回填错误码再补文案。

### #7 双端会话持久化（鸿蒙 + Android 各一遍）

> 进度（2026-11-15）：鸿蒙侧第 1–5 项已按 4.0 / 4.1 / 4.2 给出设备证据，含彻底退出进程
> 后重启回看、删除会话不复活、会话与计划分文件独立保留（本次未打卡，`records` 为空）、
> 损坏文件保护；**Android 侧全部仍待验收**。

1. 产生多轮对话（含一次工具调用）→ **彻底退出进程** → 重新打开 → 从历史列表回看，核对内容与顺序。
2. 新建 / 切换会话 / 连续发送，确认设备文件读写使用同一仓库与应用私有目录。
3. 删除会话 → 重启 → 已删除会话不再出现；**学习计划与打卡独立保留**（不同存储 key）。
4. 存储异常反馈：可用 DevEco 的文件管理或 adb 在应用私有目录放入损坏的
   `campus_agent_sessions_v1.json`，确认界面提示「先备份，不要继续写入」，且原文件**未被覆盖**；
   恢复后重启可正常读取。
5. 注明三个存储边界：`sessions_v1`（会话）、`study_data_v1`（计划/打卡）、日历映射记录。

### #11 需要 C 提交的材料

- 本文件 + `docs/模型与数据验证说明.md` + `docs/DeepSeek接入与验证.md`；
- 电脑侧 `npm run check` 输出、`verify-model.mjs` 脱敏报告；
- 上述 #6 / #7 的设备记录与脱敏截图；
- 确认交付物中不含密钥、签名私钥、`.env.local` 或个人路径。

## 五、#12（P2）为什么本轮没有动

[#12 扩展用户条件、学习路径与计划版本的数据持久化](https://github.com/Tsuki638/arkuix-campus-agent/issues/12)
第一项验收标准是「**与 A/B 冻结结构**」，且 #13 / #14 / #15 / #18 / #19 都依赖它。C 单方面
改 `contracts/` 公共端口会与 A、B 的在途工作冲突。

**已知情况**：A 在 `origin/feat/agent`（`25efc81`，2026-11-10）已经实现了完整的方向访谈、
候选路径、任务拆解、约束排期与计划修订数据结构，**127 项测试全绿，但尚未合并进 main**。
队长整合的 app 雏形是 PR #2 / #3，不含这一分支。

因此建议顺序：先由队长决定 `feat/agent` 的合并方式（A 发 PR，或授权做冲突整合，双方有
37 个重叠文件）→ 结构冻结后 C 再按 A 的字段扩展 `StudyDataRepository` 并做版本迁移。
本轮不改公共接口，避免制造重复实现。
