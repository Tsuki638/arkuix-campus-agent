# Campus Agent 项目说明

## 服务器部署

- Campus Agent 的 Java 21 / Spring Boot 后端已部署在 Ubuntu 云服务器上，由 systemd 服务 `campus-agent.service` 管理。Java 监听 `127.0.0.1:8080`，Caddy 提供公网入口 `https://api.kaleteam.cn`。
- 公网健康检查为 `https://api.kaleteam.cn/actuator/health`。原生客户端通过 `ARKUI_BACKEND_URL` 配置后端地址。
- 本地发布包为 `backend/target/campus-agent-backend.jar`。服务器实际运行的 JAR 路径以 `systemctl show -p ExecStart -p WorkingDirectory campus-agent` 为准。
- 服务器的持久化目录为 `/var/lib/campus-agent`，保存账号和各设备同步的历史。更新后端时保留该目录和现有服务环境配置。
- 用户自行操作服务器。提供部署指导时用中文，标明哪些命令在 Windows PowerShell 执行，哪些在 Ubuntu 的 SSH 终端执行，并说明各步骤的用途。
