# Java 后端

本工程使用 Java 21、Spring Boot 4.1.2 和 Maven，为 ArkUI-X 提供 Agent、会话、模型、学习计划、打卡和设备日历草案接口。

```text
src/main/java/com/campusagent/
├── CampusAgentApplication.java
├── common/                  # 统一响应、业务异常与错误处理
├── config/                  # 配置绑定与 HTTP/CORS
├── system/                  # 已实现的联调模块
│   ├── controller/
│   ├── service/
│   └── dto/
├── auth/                    # 账号、鉴权和设备会话
├── agent/                   # Agent 编排与会话
├── conversation/            # 会话与消息
├── studyplan/               # 计划、任务与打卡
├── model/                   # 云模型接入
├── web/                     # 公开网页搜索和正文读取
├── calendar/                # 草案与设备执行回执
└── infrastructure/
    └── persistence/         # 工作区文件持久化
```

启动和读写历史无需模型密钥。生成回复需要在服务端配置默认密钥，或在客户端模型设置中提供运行时密钥。

在本目录执行，Windows 使用 `mvnw.cmd`，Linux/macOS 使用 `sh ./mvnw`：

```powershell
$env:JAVA_HOME = '你的 JDK 21 根目录'
.\mvnw.cmd spring-boot:run
.\mvnw.cmd verify
.\mvnw.cmd package
java -jar target/campus-agent-backend.jar
```

Maven Wrapper 固定 Maven 版本，首次运行需要联网下载 Maven 和依赖。也可从仓库根目录执行 `npm.cmd run dev:backend`、`npm.cmd run test:backend`、`npm.cmd run build:backend`。这些命令加载根目录 `.env.local`；直接运行 Maven 或 JAR 时使用 shell 环境变量，不会自动加载该文件。

默认监听 `http://127.0.0.1:8080`：

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/system/info` | 前后端连通性与接口版本检查 |
| `GET /actuator/health` | 服务健康状态 |

配置变量为 `SERVER_ADDRESS`、`SERVER_PORT` 和 `APP_CORS_ALLOWED_ORIGINS`，示例见根目录 `.env.example`。CORS 列表针对浏览器来源，原生 ArkUI-X 请求通常不经过浏览器 CORS 校验。

业务接口位于 `/api/v1/workspace`，完整定义见 [OpenAPI](../contracts/openapi.yaml)。默认模型读取 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_MODEL`。可用 `APP_MODEL_ENDPOINT`、`APP_MODEL_NAME`、`APP_MODEL_API_KEY` 配置其他默认模型。自定义运行时模型由 `APP_MODEL_ALLOWED_ENDPOINTS` 配置完整 HTTPS 地址，以逗号分隔。

账号的「服务器默认」或「自定义」选择由 `/api/v1/workspace/model/preference` 读取和保存。服务端默认模型使用部署环境中的模型密钥。要启用自定义密钥保存，在服务器环境变量 `APP_MODEL_CREDENTIAL_KEY` 设置一次独立的 32 字节 Base64 加密密钥，可用 `openssl rand -base64 32` 生成。部署更新时保留该变量的值，并与数据分开安全备份。应用用它加密工作区中的自定义模型密钥。用户使用同一账号重新登录时会恢复保存的选择和模型设置。

## 网页工具

配置 `APP_WEB_API_KEY` 或 `DEEPSEEK_API_KEY` 后，后端为支持函数调用的模型提供 `search_web` 和 `read_web_page`。网页请求由 [DeepSeek Search & Fetch](https://api-docs.deepseek.com/guides/search/) 执行。每轮可搜索最多 3 次并读取最多 6 页，同一步的公开网页请求最多 3 个并发。没有密钥时，后端保留普通对话和原有工具。

在连接 Java 后端的聊天中试用「读取 https://example.com/ 并概括正文，附来源链接」，或「搜索北京 Java 后端实习，打开一条企业官网的岗位详情并整理岗位要求」。搜索摘要用于发现候选，核实岗位要求应以可读取的详情页为准。

## 账号、同步与部署

`/api/v1/auth/register` 注册并登录，`/api/v1/auth/login` 登录已注册账号。业务接口要求 `Authorization: Bearer <token>`。服务端从令牌确认账号和设备，退出登录只撤销当前设备的会话。密码使用独立盐和 PBKDF2-HMAC-SHA256 哈希，服务端保存登录令牌的哈希。 [OWASP 密码存储指南](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

使用 `APP_DATA_DIRECTORY` 指定持久化目录，默认写入服务工作目录下的 `backend-data/`。部署时备份整个目录，包含 `accounts.json`、`account-*.json` 和待导入的旧工作区文件。服务以单实例读写该目录。

公网或跨设备登录使用 HTTPS。TLS 在反向代理结束时，让代理保留 `Authorization` 并设置转发协议，Java 放在回环地址或私有网络。代理经私有网络连接 Java 时，可在可信代理之后设置 `SERVER_FORWARD_HEADERS_STRATEGY=native`。客户端的 `ARKUI_BACKEND_URL` 使用该 HTTPS 地址。

Spring Boot 与 JDK 的兼容要求参考[官方系统要求](https://docs.spring.io/spring-boot/system-requirements.html)。
