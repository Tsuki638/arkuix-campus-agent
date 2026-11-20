# 大学生学习规划 Agent

基于 ArkUI-X 客户端与 Java 后端的前后端分离工程。客户端继续面向鸿蒙和 Android，后端使用 Java 21、Spring Boot 4.1.2 和 Maven。

**Java 后端模式支持注册、登录和跨设备同步。** 登录同一个账号的手机、平板和鸿蒙电脑可访问该账号的对话、学习计划、打卡和日历草案。ArkUI-X 负责页面、语音、设备权限和系统日历写入。

## 工程目录

```text
.
├── frontend/
│   ├── arkuix/                  # 原 app/，完整 ArkUI-X 客户端工程
│   │   ├── AppScope/
│   │   ├── entry/src/main/ets/
│   │   │   ├── pages/、ui/      # 页面与组件
│   │   │   ├── bootstrap/       # 端内与后端运行时装配
│   │   │   ├── contracts/       # 客户端内部端口与 HTTP 类型
│   │   │   ├── platform/        # 语音、日历、HTTP 等平台适配
│   │   │   ├── services/        # 端侧服务与新增 backend/ HTTP 客户端
│   │   │   └── agent/           # 端内模式 Agent
│   │   └── .arkui-x/            # 原生宿主
│   └── tests/                   # 原 tests/，客户端逻辑检查
├── backend/
│   ├── src/main/java/com/campusagent/
│   │   ├── common/、config/     # 响应、异常与配置
│   │   ├── system/             # 已实现：系统联调接口
│   │   ├── auth/               # 注册、登录和设备会话
│   │   ├── agent/              # Agent 编排
│   │   ├── conversation/       # 会话与消息
│   │   ├── studyplan/          # 学习计划与打卡
│   │   ├── model/              # 云模型适配
│   │   ├── calendar/           # 日历草案与执行回执
│   │   └── infrastructure/     # 数据访问实现
│   ├── src/main/resources/     # Spring Boot 配置
│   ├── src/test/               # Java 集成测试
│   ├── pom.xml
│   └── mvnw、mvnw.cmd          # Maven Wrapper
├── contracts/                  # 前后端 OpenAPI 契约
├── infra/                      # Docker Compose
├── scripts/                    # 准备、检查、构建与联调入口
├── docs/                       # 架构、迁移、原功能与验收记录
├── .github/workflows/          # 前后端独立 CI 检查
├── .env.example
└── package.json                # 仓库开发命令，Node 不承担后端服务
```

## 启动开发

客户端逻辑检查需要 Node.js 22.13 或以上版本，无需安装 npm 依赖。Java 后端需要 JDK 21 或以上版本；Maven Wrapper 首次运行需要联网下载构建工具与依赖。客户端构建继续使用团队现有 DevEco Studio、HarmonyOS SDK 和 ArkUI-X SDK 组合。

在仓库根目录执行：

```powershell
# 检查原客户端逻辑与新的后端 HTTP 客户端
npm.cmd run check

# 设置本终端的 JDK 路径，启动 Java 后端
$env:JAVA_HOME = '你的 JDK 21 根目录'
npm.cmd run dev:backend
```

在另一终端执行：

```powershell
# 使用实际的前端 TS 客户端请求 Java 接口
npm.cmd run verify:backend
```

默认后端地址为 `http://127.0.0.1:8080`。系统接口为 `GET /api/v1/system/info`，健康检查为 `GET /actuator/health`。完整定义见[OpenAPI](contracts/openapi.yaml)。

本地联调时，在根目录 `.env.local` 设置 `ARKUI_BACKEND_URL=http://127.0.0.1:8080`，执行 `npm.cmd run prepare:model`，然后用 DevEco Studio 打开 **`frontend/arkuix/`**，重新构建并运行 `entry`。首次连接本地后端时选择「创建账号」。真机或模拟器通过反向端口转发访问开发电脑，命令见[前端说明](frontend/README.md)。留空 `ARKUI_BACKEND_URL` 并重新生成配置可构建端内模式。

根目录 `.env.example` 列出了可选配置。后端的启动、测试和构建命令会读取 `.env.local`。直接运行 Maven 或 JAR 使用终端环境变量。在本地后端配置 `DEEPSEEK_API_KEY` 后可测试模型回复。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm.cmd run check` | 客户端纯 TS 转换、模块导入与自动化检查 |
| `npm.cmd run test:frontend` | 客户端自动化检查 |
| `npm.cmd run dev:backend` | 启动 Java 服务，默认 8080 端口 |
| `npm.cmd run test:backend` | Maven verify，编译与集成测试 |
| `npm.cmd run build:backend` | 构建 `backend/target/campus-agent-backend.jar` |
| `npm.cmd run verify:backend` | 运行前端到 Java 的 HTTP 联调检查 |
| `npm.cmd run check:all` | 串行检查前后端 |
| `npm.cmd run prepare:model` | 生成客户端运行模式和默认模型配置 |
| `npm.cmd run verify:deepseek` | 原端侧模型协议验证，会产生真实 API 用量 |

后端也可独立使用 `backend/mvnw.cmd`，无需 Node；Linux/macOS 使用 `sh ./mvnw`。Docker 启动方式见[基础设施说明](infra/README.md)。

## 切回云服务器

在 Windows PowerShell 的仓库根目录执行 `npm.cmd run build:backend` 生成 `backend/target/campus-agent-backend.jar`。将它上传到 Ubuntu 云服务器。在 Ubuntu 的 SSH 终端执行 `systemctl show -p ExecStart -p WorkingDirectory campus-agent`，确认当前 JAR 路径。备份并替换该 JAR，沿用现有 systemd 环境配置、Caddy 和 `/var/lib/campus-agent` 数据目录。执行 `sudo systemctl restart campus-agent` 使新包生效，然后检查 [公网健康接口](https://api.kaleteam.cn/actuator/health)。

在 Windows 上将 `.env.local` 的 `ARKUI_BACKEND_URL` 改为 `https://api.kaleteam.cn`，执行 `npm.cmd run prepare:model` 并重新构建客户端，即可让发布版连接云服务器。

## 开发边界与下一步

前端负责交互、语音、设备权限、系统日历执行与 HTTP 调用。Java 后端负责 Agent 编排、模型访问、会话、学习计划、打卡、日历草案和设备回执。

Java 后端使用单实例文件持久化，默认写入服务工作目录下的 `backend-data/`。账号与设备会话存入 `accounts.json`，学习数据按账号独立存储。升级时沿用原数据目录，在旧设备的「账号与同步」中确认导入原记录。

架构与迁移依据见[工程架构与迁移](docs/工程架构与迁移.md)，协作要求见[CONTRIBUTING](CONTRIBUTING.md)。后端版本与 Java 兼容要求参考[Spring Boot 官方系统要求](https://docs.spring.io/spring-boot/system-requirements.html)。
