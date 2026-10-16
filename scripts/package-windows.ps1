param(
    [Parameter(Mandatory = $true)][string]$BinDir,
    [Parameter(Mandatory = $true)][string]$InstallerScript
)
$ErrorActionPreference = 'Stop'
# NSIS 的 File 查找不接受 Task 拼出的混合分隔符，先转换成 Windows 本机绝对路径。
$nativeBin = [IO.Path]::GetFullPath($BinDir.Replace('/', '\'))
$nativeScript = [IO.Path]::GetFullPath($InstallerScript.Replace('/', '\'))
$bootstrapper = Join-Path $nativeBin 'webview2\MicrosoftEdgeWebview2Setup.exe'
$installer = Join-Path $nativeBin 'ai-group-chat-windows-setup.exe'
if (!(Test-Path -LiteralPath $bootstrapper -PathType Leaf)) {
    throw "缺少 WebView2 引导程序：$bootstrapper"
}
if (!(Test-Path -LiteralPath (Join-Path $nativeBin 'ai-group-chat.exe') -PathType Leaf)) {
    throw '缺少应用程序，请先完成 Windows 构建。'
}
& makensis "-DSRC=$nativeBin" "-DWEBVIEW2=$bootstrapper" "-DOUT=$installer" $nativeScript
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (!(Test-Path -LiteralPath $installer -PathType Leaf)) { throw '安装包未生成。' }
