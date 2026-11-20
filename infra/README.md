# 本地基础设施

仓库根目录可使用 Docker Compose 构建并启动 Java 服务：

```powershell
docker compose -f infra/compose.yml up --build backend
docker compose -f infra/compose.yml down
```

容器内监听 `0.0.0.0:8080`，默认发布到开发电脑的 `127.0.0.1:8080`。`BACKEND_HOST_PORT` 可修改主机端口。移动设备联调请按实际网络配置主机监听地址。业务数据由命名卷 `backend-data` 持久化。可将 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_MODEL` 传给 Compose，例如给启动命令增加 `--env-file .env.local`。
