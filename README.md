# 跨端 AI Agent：四人协作基础框架

依据仓库中的课程命题文档搭建。必做目标是 **ArkUI-X 一套业务与 UI 代码 → 鸿蒙 + Android**，具备真实大模型、Agent 流程、文本对话、鸿蒙语音和本地历史。

选题尚未确定，暂用“学习任务助手”展示最小闭环：提出学习目标 → 补充时间 → 调用学习计划工具 → 返回安排 → 回看会话。它是可替换的示例，不限制最终选题。

## 四人分工

| 成员 | 负责部分 | 主要目录 | 第一项任务 |
| --- | --- | --- | --- |
| **A：你** | **Agent 核心**：任务推进、上下文、工具、状态与失败处理 | `app/entry/src/main/ets/agent/` | 确定场景，完善一个有实际价值的工具闭环 |
| B | 共享 UI 与交互：对话、历史页、任务结果、设置 | `app/entry/src/main/ets/ui/`、`pages/` | 完善输入、工具执行反馈、空态和异常提示 |
| C | 模型与数据服务：云端调用、模型适配、历史持久化 | `app/entry/src/main/ets/services/` | 接入选定模型，并在两端验证历史读写与删除 |
| D | 平台能力与交付：鸿蒙 ASR/TTS、权限、双端工程与打包 | `app/entry/src/main/ets/platform/`、原生配置、`scripts/` | 先生成官方工程并尽早构建鸿蒙/Android，再接语音 |

具体任务、交付物、分支边界和联调节点见 [四人分工与里程碑](docs/四人分工与里程碑.md)。需要发给组员的完整任务说明可下载 [四人分工 Word 文档](docs/项目四人分工与具体任务.docx)。

## 已有框架

```text
app/entry/src/main/ets/
├── contracts/       # 公共模型与接口，四人约定
├── agent/           # A：AgentEngine、工具注册表、学习计划示例工具
├── ui/              # B：共享聊天界面、消息与工具结果
├── pages/           # B：ArkUI 页面入口
├── services/        # C：模拟/云端模型、JSON 历史仓库、文件存储
├── platform/        # D：HTTP 系统适配、语音能力接口占位
└── bootstrap/       # 四个模块的依赖装配，集中更换模拟与真实实现
scripts/             # 离线演示、共享逻辑检查、官方工程初始化、两端构建
tests/               # 关键行为检查，运行同一份共享 TS 源码
docs/                # 架构、分工、接口、构建、验收与依赖说明
```

四个部分是逻辑模块，初期放在同一个 `entry` 中。先通过接口和目录并行开发，避免过早拆成多个 HAR 或独立应用工程。

## 立即运行共享逻辑

安装 Node.js 22.13 或以上版本后，在仓库根目录运行；没有 npm 三方依赖，无需 `npm install`：

```powershell
npm.cmd run demo
npm.cmd run check
```

`demo` 展示两轮交流和一次工具调用。`check` 执行模块导入检查与 13 项行为检查，覆盖工具失败、执行上限、并发、历史恢复和模型协议。**Node 是开发检查工具；正式 UI 与业务运行在 ArkUI-X 应用中。**

## 设备工程初始化

当前交付包含共享源码和初始化脚本，**尚未包含由本机 SDK 生成的完整原生工程壳，也没有 HAP/APK**。当前环境没有可用的 ACE 命令，未执行 ArkTS 编译或两端设备验证。

由 D 安装并统一 DevEco Studio、HarmonyOS SDK、ArkUI-X SDK、Android SDK/JDK 后执行：

```powershell
ace check -v
powershell -ExecutionPolicy Bypass -File .\scripts\initialize-arkuix.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\build-native.ps1 -Platform HarmonyOS
powershell -ExecutionPolicy Bypass -File .\scripts\build-native.ps1 -Platform Android
```

上述执行策略参数仅用于本次 PowerShell 进程，运行本仓库的本地开发脚本。初始化脚本使用官方 `ace create` 模板补齐 `app/` 的工程配置、Ability 和 Android 宿主，保留本仓库已有共享源码。请阅读 [构建与运行](docs/构建与运行.md)，完成版本、API 支持、权限与签名检查后构建。

默认设备装配使用模拟模型和本地文件历史；云端模型适配器已提供但未连接真实服务；语音明确标记为待接入。模拟模型、内存检查、接口占位均不代表课程必做项已经验收通过。

## 协作入口

- [GitHub 协作开发说明](CONTRIBUTING.md)：克隆仓库、四人分支和提交合并流程。
- [一页纸架构](docs/一页纸架构.md)：四个模块怎样协作。
- [四人分工与里程碑](docs/四人分工与里程碑.md)：各人做什么、如何验收。
- [接口约定](docs/接口约定.md)：方法签名、数据格式与失败规则。
- [构建与运行](docs/构建与运行.md)：官方模板、真模型接入、两端构建。
- [验收清单](docs/验收清单.md)：课程六项基线与负责人。
- [第三方依赖与资料](docs/第三方依赖与资料.md)：官方来源和依赖登记。
