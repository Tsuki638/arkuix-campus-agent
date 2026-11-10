# 四人协作开发说明

## 获取代码

```bash
git clone https://github.com/Tsuki638/arkuix-campus-agent.git
cd arkuix-campus-agent
npm run check
```

共享逻辑检查使用 Node.js 22.13 或以上版本，无需安装 npm 依赖。设备工程按照 [构建与运行](docs/构建与运行.md) 配置。

## 选择自己的任务与分支

| 成员 | 建议分支 | 主要目录 |
| --- | --- | --- |
| A | `feat/agent` | `app/entry/src/main/ets/agent/` |
| B | `feat/ui` | `app/entry/src/main/ets/ui/`、`pages/` |
| C | `feat/services` | `app/entry/src/main/ets/services/` |
| 你（D，语音模块） | `feat/platform` | `app/entry/src/main/ets/platform/speech/`、语音自测页、语音检查与准备脚本 |

当前分工以 [分工说明](docs/四人分工与里程碑.md) 为准：A 负责 Agent，B 负责 UI，C 负责模型与数据，你负责语音模块。平台工程、日历适配与构建打包的负责人另行明确。[Word 任务文档](docs/项目四人分工与具体任务.docx) 为历史导出，人员分工可能尚未同步。

以 A 开始开发为例：

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/agent
```

其他成员将分支名替换成自己负责的部分。继续已有分支时使用 `git switch 分支名`。

## 提交与合并

1. 优先修改自己负责的目录。公共接口 `contracts/` 和依赖装配 `bootstrap/` 的修改先与组员同步。
2. 对共享逻辑的改动，提交前运行 `npm run check`。涉及 UI、系统 API 或构建配置时，记录对应设备或构建验证结果。
3. 检查 `git status`，将本次改动加入暂存区并提交，再推送自己的开发分支。
4. 在 GitHub 提交合并到 `main` 的 Pull Request，说明改动目的、验证方式以及需要其他成员配合的接口变化。
5. 合并前确认不会覆盖其他成员的实现，保持鸿蒙和 Android 共用核心业务与 UI。

```bash
git add path/to/changed-file
git commit -m "feat: describe the change"
git push -u origin feat/agent
```

## 工程文件与配置

- 平台工程负责人统一生成并尽早提交官方 ArkUI-X 工程配置，其他成员同步同一套模板与 SDK 组合。
- 本机 SDK 路径、模型密钥、签名证书、构建产物和 `.generated/` 不加入提交。
- 密钥通过运行时配置传入；日志、截图和会话历史中不记录密钥。
- `.gitattributes` 统一文本换行，Word 等二进制文件按二进制处理。
