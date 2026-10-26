param(
  [string]$DshCommand = '',
  [string]$HarnessExe = ''
)
# 一键安装：关闭 Harness（先询问）→ 移除旧版 → 安装当前版本 → 重新打开 Harness。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
$title = 'DeepSeek 灵动岛 · 安装'
function Say([string]$message, [string]$icon = 'Information') { [System.Windows.MessageBox]::Show($message, $title, 'OK', $icon) | Out-Null }
# 找到 Harness：参数 > 正在运行的进程 > 常见安装位置。
function Find-HarnessExe {
  $running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1
  if ($running) { return $running.Path }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
    (Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe'),
    'D:\deepseek harness\DeepSeek Harness.exe',
    'D:\DeepSeek Harness\DeepSeek Harness.exe'
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return ''
}
try {
  if (-not $HarnessExe) { $HarnessExe = Find-HarnessExe }
  if (-not $DshCommand -and $HarnessExe) { $DshCommand = Join-Path (Split-Path -Parent $HarnessExe) 'resources\runtime\cli\bin\dsh.cmd' }
  $root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
  $pkg = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $archive = Join-Path $root "artifacts\dsh-island-$($pkg.version).tgz"
  if (-not (Test-Path -LiteralPath $archive)) {
    # 从仓库克隆时没有现成的安装包：用 npm 现场打包。
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "找不到安装包：$archive`n请安装 Node.js 后重试，或在 Harness 的「插件 › 添加插件」中输入 dsh-island 安装。" }
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'artifacts') | Out-Null
    Push-Location $root
    $ErrorActionPreference = 'Continue'
    try { & npm pack --pack-destination artifacts --ignore-scripts 2>&1 | Out-Null } finally { Pop-Location; $ErrorActionPreference = 'Stop' }
    if (-not (Test-Path -LiteralPath $archive)) { throw "打包失败，找不到：$archive" }
  }
  if (-not $DshCommand -or -not (Test-Path -LiteralPath $DshCommand)) { throw "找不到 DeepSeek Harness 的安装位置。`n请先打开一次 Harness 再运行本脚本，或用 -HarnessExe 指定 DeepSeek Harness.exe 的路径。" }

  $running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
  if ($running) {
    $answer = [System.Windows.MessageBox]::Show("安装前需要先关闭 DeepSeek Harness。`n现在关闭吗？正在进行的任务会被中断。", $title, 'YesNo', 'Question')
    if ($answer -ne 'Yes') { return }
    $running | Stop-Process -ErrorAction SilentlyContinue
    $running | Wait-Process -Timeout 20 -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) { throw 'Harness 没能关闭，请从托盘右键退出后再试。' }
  }

  $log = Join-Path $root 'artifacts\install.log'
  $ErrorActionPreference = 'Continue'
  "== $(Get-Date -Format s) 安装 dsh-island $($pkg.version)" | Out-File -LiteralPath $log -Encoding UTF8
  # 没装过旧版时这一步会报错，忽略即可。
  & $DshCommand plugin --profile desktop remove $pkg.name 2>&1 | Out-File -LiteralPath $log -Append -Encoding UTF8
  & $DshCommand plugin --profile desktop add $archive 2>&1 | Out-File -LiteralPath $log -Append -Encoding UTF8
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($code -ne 0) {
    $tail = (Get-Content -LiteralPath $log -Tail 12 -Encoding UTF8) -join "`n"
    throw "安装失败（退出码 $code）。`n`n$tail`n`n完整记录：$log"
  }
  if (Test-Path -LiteralPath $HarnessExe) { Start-Process -FilePath $HarnessExe }
  Say "已安装 DeepSeek 灵动岛 $($pkg.version)。`nHarness 正在重新打开，灵动岛会出现在屏幕上。`n`n单击灵动岛查看任务详情；位置、大小和提醒方式在 Harness 的「设置 › 灵动岛」中调整。"
} catch {
  Say $_.Exception.Message 'Error'
}
