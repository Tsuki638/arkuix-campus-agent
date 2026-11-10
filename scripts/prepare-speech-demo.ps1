param(
    [string]$TemplateProject = '',
    [string]$OutputDirectory = '',
    [ValidateSet('Diagnostics', 'Chat')]
    [string]$StartPage = 'Diagnostics',
    [string]$BundleName = 'com.example.campusagentspeech',
    [string]$AppName = '学习助手语音自测'
)
$ErrorActionPreference = 'Stop'
function Write-ProjectText([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding $false))
}
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $TemplateProject) {
    $environmentFile = Join-Path $repoRoot '.generated\environment\dev-environment.json'
    if (Test-Path -LiteralPath $environmentFile) {
        $TemplateProject = (Get-Content -LiteralPath $environmentFile -Raw -Encoding UTF8 | ConvertFrom-Json).validationProject
    }
}
if (-not $TemplateProject -or -not (Test-Path -LiteralPath (Join-Path $TemplateProject 'entry\src\main\module.json5'))) {
    throw '请通过 -TemplateProject 指定同版本 SDK 创建的官方 Stage 空工程。不会修改该工程。'
}
$templateBuildProfile = Get-Content -LiteralPath (Join-Path $TemplateProject 'build-profile.json5') -Raw -Encoding UTF8
if ($templateBuildProfile -notmatch '"signingConfigs"\s*:\s*\[\s*\]') {
    throw '模板须为 signingConfigs 为空的官方空工程，避免复制个人签名配置。已有自测工程的签名配置会保留。'
}
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot '.generated\speech-demo' }
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$sourceRoot = [System.IO.Path]::GetFullPath($TemplateProject)
if ($outputRoot.TrimEnd('\') -eq $sourceRoot.TrimEnd('\')) { throw '输出目录不能与模板工程相同。' }
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
# 只补齐模板骨架；不复制构建缓存、设备签名、本地路径或 Android/iOS 宿主。
foreach ($relative in @('AppScope', 'hvigor', 'entry\src\main\resources', 'entry\src\main\ets\entryability')) {
    $source = Join-Path $sourceRoot $relative
    if (Test-Path -LiteralPath $source) {
        Get-ChildItem -LiteralPath $source -Recurse -File | ForEach-Object {
            $path = $_.FullName.Substring($sourceRoot.Length + 1)
            $target = Join-Path $outputRoot $path
            if (-not (Test-Path -LiteralPath $target)) {
                New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
                Copy-Item -LiteralPath $_.FullName -Destination $target
            }
        }
    }
}
foreach ($relative in @('build-profile.json5', 'hvigorfile.ts', 'oh-package.json5',
    'entry\build-profile.json5', 'entry\hvigorfile.ts', 'entry\oh-package.json5',
    'entry\obfuscation-rules.txt', 'entry\src\main\module.json5', '.arkui-x\arkui-x-config.json5')) {
    $source = Join-Path $sourceRoot $relative
    $target = Join-Path $outputRoot $relative
    if ((Test-Path -LiteralPath $source) -and -not (Test-Path -LiteralPath $target)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target
    }
}
$etsRoot = Join-Path $repoRoot 'app\entry\src\main\ets'
$entryProfileFile = Join-Path $outputRoot 'entry\build-profile.json5'
if (-not (Test-Path -LiteralPath (Join-Path $outputRoot 'entry\src\ohosTest\module.json5'))) {
    # 当前联调工程只构建应用目标；空模板的 ohosTest 目标需要其独立测试模块。
    $entryProfile = Get-Content -LiteralPath $entryProfileFile -Raw -Encoding UTF8
    $entryProfile = $entryProfile -replace ',\s*\{\s*"name"\s*:\s*"ohosTest"\s*,?\s*\}', ''
    Write-ProjectText $entryProfileFile $entryProfile
}
$demoEts = Join-Path $outputRoot 'entry\src\main\ets'
foreach ($sourceFile in (Get-ChildItem -LiteralPath $etsRoot -Recurse -File)) {
    $relative = $sourceFile.FullName.Substring($etsRoot.Length + 1)
    $target = Join-Path $demoEts $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    if ($sourceFile.FullName -ne [System.IO.Path]::GetFullPath($target)) {
        Copy-Item -LiteralPath $sourceFile.FullName -Destination $target -Force
    }
}
# 模板 JSON5 含注释、单引号时也能保留原配置；仅合并本页需要的字段。
$moduleFile = Join-Path $outputRoot 'entry\src\main\module.json5'
$moduleText = Get-Content -LiteralPath $moduleFile -Raw -Encoding UTF8
if ($moduleText -notmatch 'ohos.permission.MICROPHONE') {
    if ($moduleText -match '"requestPermissions"\s*:') {
        throw '模板已有 requestPermissions，请使用未改动的空工程，以免覆盖权限配置。'
    }
    $permission = '"requestPermissions": [{"name":"ohos.permission.MICROPHONE","reason":"$string:microphone_reason","usedScene":{"abilities":["EntryAbility"],"when":"inuse"}}],'
    $moduleText = $moduleText -replace '("module"\s*:\s*\{)', ('$1' + "`n    " + $permission)
}
Write-ProjectText $moduleFile $moduleText
if ($moduleText -notmatch 'ohos.permission.INTERNET') {
    $moduleText = $moduleText -replace '("requestPermissions"\s*:\s*\[)', '$1 {"name":"ohos.permission.INTERNET"},'
    Write-ProjectText $moduleFile $moduleText
}
$stringsFile = Join-Path $outputRoot 'entry\src\main\resources\base\element\string.json'
$strings = Get-Content -LiteralPath $stringsFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not ($strings.string | Where-Object { $_.name -eq 'microphone_reason' })) {
    $strings.string += [pscustomobject]@{ name = 'microphone_reason'; value = '用于将你的语音转换为学习规划问题' }
}
Write-ProjectText $stringsFile ($strings | ConvertTo-Json -Depth 12)
$pagesFile = Join-Path $outputRoot 'entry\src\main\resources\base\profile\main_pages.json'
Write-ProjectText $pagesFile '{"src":["pages/SpeechDiagnostics","pages/Index"]}'
$abilityFile = Join-Path $demoEts 'entryability\EntryAbility.ets'
$abilityText = Get-Content -LiteralPath $abilityFile -Raw -Encoding UTF8
$entryPage = if ($StartPage -eq 'Chat') { 'pages/Index' } else { 'pages/SpeechDiagnostics' }
$abilityText = $abilityText.Replace('pages/SpeechDiagnostics', $entryPage).Replace('pages/Index', $entryPage)
Write-ProjectText $abilityFile $abilityText
$arkuiFile = Join-Path $outputRoot '.arkui-x\arkui-x-config.json5'
$arkuiText = Get-Content -LiteralPath $arkuiFile -Raw -Encoding UTF8
$arkuiText = $arkuiText -replace '"ignoreCrossPlatform"\s*:\s*(true|false)\s*,?', ''
if ($arkuiText -match '"buildOption"\s*:\s*\{') {
    $arkuiText = $arkuiText -replace '("buildOption"\s*:\s*\{)', '$1 "ignoreCrossPlatform": true,'
} else {
    $arkuiText = $arkuiText -replace '("crossplatform"\s*:\s*true\s*,)', '$1 "buildOption": {"ignoreCrossPlatform": true},'
}
Write-ProjectText $arkuiFile $arkuiText
# 自测工程使用独立包名，避免覆盖原环境验证应用。
$appFile = Join-Path $outputRoot 'AppScope\app.json5'
$appText = Get-Content -LiteralPath $appFile -Raw -Encoding UTF8
$appText = [regex]::Replace($appText, '("bundleName"\s*:\s*")[^"]+("\s*)', {
    param($match) $match.Groups[1].Value + $BundleName + $match.Groups[2].Value
})
Write-ProjectText $appFile $appText
$appStringsFile = Join-Path $outputRoot 'AppScope\resources\base\element\string.json'
$appStrings = Get-Content -LiteralPath $appStringsFile -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($entry in $appStrings.string) {
    if ($entry.name -eq 'app_name') { $entry.value = $AppName }
}
Write-ProjectText $appStringsFile ($appStrings | ConvertTo-Json -Depth 12)
Write-Output "共享应用工程已准备：$outputRoot；启动页：$entryPage"
Write-Output '用 DevEco 打开此目录，完成同步后，选择模拟器运行；不需要模型 API Key。'
Write-Output '重新执行此脚本会更新语音源码，保留已有工程配置与签名设置。'
