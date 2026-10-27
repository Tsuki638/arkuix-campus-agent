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
    if ($Platform -eq 'HarmonyOS') { & $AceCommand build hap --debug }
    else { & $AceCommand build apk --debug }
    if ($LASTEXITCODE -ne 0) { throw "$Platform 构建失败，请查看 ACE 输出。" }
} finally { Pop-Location }
