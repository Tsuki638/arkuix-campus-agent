param([string]$TemplateProject = '')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $TemplateProject) {
    $environmentFile = Join-Path $repoRoot '.generated\environment\dev-environment.json'
    if (Test-Path -LiteralPath $environmentFile) {
        $TemplateProject = (Get-Content -LiteralPath $environmentFile -Raw -Encoding UTF8 | ConvertFrom-Json).validationProject
    }
}
if (-not $TemplateProject) { throw '请通过 -TemplateProject 指定同版本 SDK 创建的官方 ArkUI-X 空工程。' }
$appRoot = Join-Path $repoRoot 'app'
& (Join-Path $PSScriptRoot 'prepare-speech-demo.ps1') -TemplateProject $TemplateProject `
    -OutputDirectory $appRoot -StartPage Chat -BundleName 'com.example.campusagent' -AppName '学习规划助手'

# 只导入官方 Android 宿主源码；引擎资源和编译产物由 ACE 在构建时生成。
$androidSource = Join-Path $TemplateProject '.arkui-x\android'
if (-not (Test-Path -LiteralPath $androidSource)) { throw '模板缺少官方 Android 宿主。' }
$appText = Get-Content -LiteralPath (Join-Path $TemplateProject 'AppScope\app.json5') -Raw -Encoding UTF8
$bundleMatch = [regex]::Match($appText, '"bundleName"\s*:\s*"([^"]+)"')
if (-not $bundleMatch.Success) { throw '无法读取模板包名。' }
$oldBundle = $bundleMatch.Groups[1].Value
$oldPackagePath = $oldBundle.Replace('.', '\')
$newPackagePath = 'com\example\campusagent'
foreach ($file in (Get-ChildItem -LiteralPath $androidSource -Recurse -File -Force)) {
    $relative = $file.FullName.Substring($androidSource.Length + 1)
    if ($relative -match '(^|[\\/])(build|\.gradle|\.idea|libs)([\\/]|$)' -or
        $relative -match 'assets[\\/]arkui-x[\\/]' -or
        $relative -match 'src[\\/](test|androidTest)[\\/]' -or $file.Name -eq 'local.properties') { continue }
    $relative = $relative.Replace($oldPackagePath, $newPackagePath)
    $target = Join-Path (Join-Path $appRoot '.arkui-x\android') $relative
    if (Test-Path -LiteralPath $target) { continue }
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    if ($file.Extension -in @('.java', '.gradle', '.xml', '.properties', '.bat') -or $file.Extension -eq '') {
        $content = (Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8).Replace($oldBundle, 'com.example.campusagent')
        [System.IO.File]::WriteAllText($target, $content, [System.Text.UTF8Encoding]::new($false))
    } else { Copy-Item -LiteralPath $file.FullName -Destination $target }
}
$androidStrings = Join-Path $appRoot '.arkui-x\android\app\src\main\res\values\strings.xml'
if (Test-Path -LiteralPath $androidStrings) {
    $content = Get-Content -LiteralPath $androidStrings -Raw -Encoding UTF8
    $content = $content -replace '(<string name="app_name">)[^<]*(</string>)', '${1}学习规划助手${2}'
    [System.IO.File]::WriteAllText($androidStrings, $content, [System.Text.UTF8Encoding]::new($false))
}
Write-Output '整合工程位于 app/，共享聊天、学习计划、模型设置和语音使用同一份源码。'
Write-Output '用 DevEco 打开 app/；鸿蒙和 Android 安装运行结果需分别验收。'
