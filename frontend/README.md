# 前端工程

`arkuix/` 是现有鸿蒙、Android 共享客户端的完整工程，包含原生宿主、资源和本机配置。用 DevEco Studio 打开 `frontend/arkuix/`。`tests/` 集中保存客户端纯 TypeScript 逻辑的 Node 自动化检查，测试替身位于 `tests/support/`，不进入应用安装包。

在仓库根目录执行：

```powershell
npm.cmd run check
npm.cmd run prepare:model
```

在根目录 `.env.local` 设置 `ARKUI_BACKEND_URL`，运行 `npm.cmd run prepare:model`，再构建应用。启用 Java 模式后先注册或登录。各设备连接同一个 Java 服务并登录同一个账号，即可查看对应历史。应用回到前台时会刷新账号记录，也可打开侧栏中的账号，点击「同步记录」。

升级后在有旧数据的设备上打开「账号与同步」，点击「导入这台设备的旧记录」并确认当前账号。原端内文件会保留。旧版 Java 模式保存的数据需要原服务端数据目录随升级保留。

本地联调使用 `ARKUI_BACKEND_URL=http://127.0.0.1:8080`。在开发电脑启动 `npm.cmd run dev:backend` 后，用 USB 连接已开启调试的真机，或启动模拟器。在 Windows PowerShell 中按设备平台执行对应的反向端口转发命令，让设备的 `127.0.0.1:8080` 访问电脑上的后端。[HarmonyOS HDC 端口转发](https://developer.huawei.com/consumer/cn/doc/harmonyOS-guides/hdc/) [Android ADB 端口转发](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server#adb-reverse)

```powershell
# HarmonyOS
hdc rport tcp:8080 tcp:8080

# Android
adb reverse tcp:8080 tcp:8080
```

发布时使用 `ARKUI_BACKEND_URL=https://api.kaleteam.cn`，重新生成配置并构建客户端。留空 `ARKUI_BACKEND_URL` 并重新生成配置可使用端内模式。

语音识别、回复朗读、日历权限和系统日历写入由设备适配器完成。详细边界见 [工程架构与迁移](../docs/工程架构与迁移.md)。
