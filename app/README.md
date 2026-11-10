# ArkUI-X 应用源码

`entry/src/main/ets/` 是鸿蒙与 Android 共享的业务及 UI 源码，按 `agent/ui/services/platform` 四个部分分工，公共边界在 `contracts/`。

此目录已补齐 **API 24 官方 ArkUI-X 工程配置、Ability、资源与 Android 宿主源码**。用 DevEco 打开本目录，完成同步与本机签名后运行 `entry`，默认进入聊天页。整合工程的未签名 HAP 构建已通过。

当前本地整合版本包含模型设置、基础学习计划保存与打卡，以及语音接入。先发送“复习高数|3”，再进入“学习计划”查看和标记任务；真实模型通过页面的“模型设置”配置。具体来源、验证边界和完整操作见[整合与联调](../docs/整合与联调.md)。

具体步骤见 [构建与运行](../docs/构建与运行.md)，分工见 [四人分工与里程碑](../docs/四人分工与里程碑.md)。

语音负责人现在可以用 [语音开发与联调](../docs/语音开发与联调.md) 中的独立工程先做模拟器测试：在根目录执行 `scripts/prepare-speech-demo.ps1`，用 DevEco 打开 `.generated/speech-demo/`。该工程使用本目录的实际共享源码，提供语音自测页和默认模拟模型的聊天入口。
