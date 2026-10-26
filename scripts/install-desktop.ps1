param([ValidateSet('Install','Remove')][string]$Action='Install', [string]$DshCommand='D:/deepseek harness/resources/runtime/cli/bin/dsh.cmd')
$ErrorActionPreference='Stop'
if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) { throw '请先从托盘退出 DeepSeek Harness，再安装或移除插件。' }
if (-not (Test-Path -LiteralPath $DshCommand)) { throw '未找到 Harness 安装程序，请使用 -DshCommand 指定桌面端随附的 dsh.cmd。' }
$islandPackage = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json
if ($Action -eq 'Remove') {
  & $DshCommand plugin --profile desktop remove $islandPackage.name
} else {
  $islandArchive = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "../artifacts/dsh-island-$($islandPackage.version).tgz")).Path
  & $DshCommand plugin --profile desktop add $islandArchive
}
if ($LASTEXITCODE -ne 0) { throw "操作失败，退出码 $LASTEXITCODE" }
Write-Host '完成，重新打开 DeepSeek Harness 后生效。'
