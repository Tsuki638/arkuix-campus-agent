# 前后端 HTTP 契约

[openapi.yaml](openapi.yaml) 定义 Java 与 ArkUI-X 之间的系统检查和工作区业务接口。ArkTS 运行时内部端口位于 `frontend/arkuix/entry/src/main/ets/contracts/`。

业务接口统一使用 `/api/v1` 前缀，成功状态使用相应 HTTP 2xx 与 `{ "code": "OK", "message": "success", "data": ... }`。错误保留 HTTP 4xx/5xx，响应体为 `{ "code": "错误码", "message": "可展示说明", "data": null }`。`/actuator/health` 使用 Actuator 的原生 `{ "status": "UP" }` 格式。CORS 预检由框架处理，不使用业务响应格式。

新增接口时同步请求、响应、状态码、错误语义和两端类型。默认模型密钥由 Java 服务管理，设备日历授权、预览确认和系统写入由客户端负责。

客户端注册或登录时提交安装标识，并获得设备会话令牌。业务接口通过 `Authorization: Bearer <token>` 获得账号和设备身份。对话发送返回 HTTP 202，客户端用同一个 `requestId` 查询状态或重发提交。日历草案携带修订号，设备确认后先提交写入意图，再逐项上报系统结果。
