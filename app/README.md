# ArkUI-X 应用源码

`entry/src/main/ets/` 是鸿蒙与 Android 共享的业务及 UI 源码，按 `agent/ui/services/platform` 四个部分分工，公共边界在 `contracts/`。

此目录目前是**源码骨架**。请由平台负责人在仓库根目录运行 `scripts/initialize-arkuix.ps1`，用团队本机的官方 ACE 模板补齐 `AppScope`、Ability、构建配置和 `.arkui-x/android` 宿主后，再用 DevEco 打开本目录。

具体步骤见 [构建与运行](../docs/构建与运行.md)，分工见 [四人分工与里程碑](../docs/四人分工与里程碑.md)。
