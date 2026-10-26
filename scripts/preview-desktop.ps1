$ErrorActionPreference='Stop'
try {
  $islandRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
  $islandNode=(Get-Command node.exe -ErrorAction Stop).Source
  $islandScript=Join-Path $PSScriptRoot 'preview.mjs'
  Start-Process -FilePath $islandNode -ArgumentList @('"'+$islandScript+'"') -WorkingDirectory $islandRoot -WindowStyle Hidden
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($_.Exception.Message,'DeepSeek 灵动岛') | Out-Null
}
