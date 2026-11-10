param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('HarmonyOS', 'Android')]
    [string]$Platform,
    [string]$AceCommand = 'ace'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $repoRoot 'app'
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'build-profile.json5'))) {
    throw '尚未初始化官方工程。先运行 scripts/initialize-arkuix.ps1。'
}
if (-not (Get-Command $AceCommand -ErrorAction SilentlyContinue)) { throw '未找到 ACE Tools，请先运行 ace check -v。' }
Push-Location -LiteralPath $appRoot
try {
    $previousErrorPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5 会把原生 stderr 包装成 ErrorRecord；收集后统一判定结果。
        $ErrorActionPreference = 'Continue'
        if ($Platform -eq 'HarmonyOS') { $buildOutput = & $AceCommand build hap --debug 2>&1 }
        else { $buildOutput = & $AceCommand build apk --debug 2>&1 }
        $buildExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorPreference }
    $buildOutput | ForEach-Object { Write-Output $_ }
    $buildText = $buildOutput -join "`n"
    # 某些 ACE 包装脚本会吞掉 Node 错误的退出码，必须同时检查构建结果与产物。
    if ($buildExitCode -ne 0 -or $buildText -match 'BUILD FAILED|Compile failed\.|Run tasks failed\.' -or
        $buildText -notmatch 'BUILD SUCCESSFUL') { throw "$Platform 构建失败，请查看 ACE 输出。" }
    $artifactDirectory = if ($Platform -eq 'HarmonyOS') { Join-Path $appRoot 'entry\build' }
        else { Join-Path $appRoot '.arkui-x\android\app\build' }
    $artifactFilter = if ($Platform -eq 'HarmonyOS') { '*.hap' } else { '*.apk' }
    if (-not (Get-ChildItem -LiteralPath $artifactDirectory -Recurse -File -Filter $artifactFilter -ErrorAction SilentlyContinue)) {
        throw "$Platform 未找到安装包产物，请核对构建结果。"
    }
} finally { Pop-Location }
