param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('HarmonyOS', 'Android')]
    [string]$Platform,
    [string]$AceCommand = 'ace'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$appRoot = Join-Path $repoRoot 'frontend\arkuix'
& node (Join-Path $PSScriptRoot 'prepare-model-config.mjs')
if ($LASTEXITCODE -ne 0) { throw '默认模型配置准备失败。' }
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'build-profile.json5'))) {
    throw '尚未初始化官方工程。先运行 scripts/initialize-arkuix.ps1。'
}
if (-not (Get-Command $AceCommand -ErrorAction SilentlyContinue)) { throw '未找到 ACE Tools，请先运行 ace check -v。' }
if ($Platform -eq 'Android') {
    # ACE 按 ArkTS 模块清单打包插件。复用增量编译缓存时，该清单可能只包含本次改动。
    $entryBuild = Join-Path $appRoot 'entry\build\default'
    $generatedPaths = @(
        (Join-Path $entryBuild 'cache\default\default@CompileArkTS'),
        (Join-Path $entryBuild 'intermediates\loader_out\default\ets\modules.abc')
    )
    $appPrefix = (Resolve-Path -LiteralPath $appRoot).ProviderPath.TrimEnd('\') + '\'
    foreach ($path in $generatedPaths) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $resolved = (Resolve-Path -LiteralPath $path).ProviderPath
        $item = Get-Item -LiteralPath $resolved
        if (-not $resolved.StartsWith($appPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "无法安全清理 ArkTS 编译产物：$path"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
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
    $artifacts = Get-ChildItem -LiteralPath $artifactDirectory -Recurse -File -Filter $artifactFilter -ErrorAction SilentlyContinue
    if (-not $artifacts) {
        throw "$Platform 未找到安装包产物，请核对构建结果。"
    }
    if ($Platform -eq 'Android') {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $apk = $artifacts | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        $archive = [System.IO.Compression.ZipFile]::OpenRead($apk.FullName)
        try {
            $engineLibraries = $archive.Entries | Where-Object FullName -Match '^lib/[^/]+/libarkui_android\.so$'
            if (-not $engineLibraries) { throw 'APK 缺少 ArkUI-X Android 运行库。' }
            foreach ($engineLibrary in $engineLibraries) {
                $abiDirectory = $engineLibrary.FullName.Substring(0, $engineLibrary.FullName.LastIndexOf('/') + 1)
                foreach ($library in @('libdeviceinfo.so', 'libfile_fs.so', 'libnet_http.so', 'libutil.so')) {
                    if (-not $archive.GetEntry($abiDirectory + $library)) {
                        throw "APK 缺少 ArkUI-X 运行库 $abiDirectory$library。"
                    }
                }
            }
        } finally { $archive.Dispose() }
    }
} finally { Pop-Location }
