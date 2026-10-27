param([string]$AceCommand = 'ace')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $repoRoot 'app'
if (Test-Path -LiteralPath (Join-Path $appRoot 'build-profile.json5')) {
    Write-Output 'app 已有原生工程配置，无需重复初始化。'
    exit 0
}
if (-not (Get-Command $AceCommand -ErrorAction SilentlyContinue)) {
    throw '未找到 ACE Tools。请安装匹配的 DevEco Studio / ArkUI-X SDK，配置 ACE PATH，再运行 ace check -v。'
}
$stagingParent = Join-Path $repoRoot '.generated\native-bootstrap'
$generatedRoot = Join-Path $stagingParent 'CampusAgent'
if (Test-Path -LiteralPath $generatedRoot) {
    throw "官方模板暂存目录已存在：$generatedRoot。请先检查上次生成结果，保留或另行备份后重试。"
}
New-Item -ItemType Directory -Path $stagingParent -Force | Out-Null
Push-Location -LiteralPath $stagingParent
try {
    Write-Output '创建官方 ArkUI-X 模板。工程名建议 CampusAgent，包名 com.example.campusagent；runtimeOS 请选择 HarmonyOS。'
    Write-Output '若询问跨平台目标，选择默认 Android+iOS，保留 DevEco 支持；本项目仅要求验收鸿蒙和 Android。'
    & $AceCommand create CampusAgent
    if ($LASTEXITCODE -ne 0) { throw 'ace create 失败，未合并原生工程。' }
} finally { Pop-Location }
foreach ($required in @('build-profile.json5', '.arkui-x\arkui-x-config.json5', 'entry\src\main\module.json5')) {
    if (-not (Test-Path -LiteralPath (Join-Path $generatedRoot $required))) {
        throw "模板缺少 $required，请确认创建的是 ArkUI-X Stage 工程。"
    }
}
# 只补齐当前 SDK 生成的工程文件；已编写的共享源码始终保留。
Get-ChildItem -LiteralPath $generatedRoot -Recurse -File -Force | ForEach-Object {
    $relativePath = $_.FullName.Substring($generatedRoot.Length + 1)
    if ($relativePath -notmatch '(^|[\\/])(oh_modules|build|\.idea|\.hvigor|\.gradle)([\\/]|$)' -and
        $_.Name -ne 'local.properties') {
        $targetPath = Join-Path $appRoot $relativePath
        if (-not (Test-Path -LiteralPath $targetPath)) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $targetPath
        }
    }
}
Write-Output '原生工程壳已合并到 app，共享业务与页面源码已保留。'
Write-Output '请用 DevEco 打开 app，按 docs/构建与运行.md 检查 SDK、跨端 API、权限和签名，再构建两端。'
