# 一键发布：GitHub（公开仓库 <你的用户名>/dsh-island）+ npm（包名 dsh-island）。
# 登录都在浏览器里完成，本脚本不读取、不保存任何密码或令牌。
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$Host.UI.RawUI.WindowTitle = '发布 DeepSeek 灵动岛'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root

function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Done([string]$text) { Write-Host "   $text" -ForegroundColor Green }
function Fail([string]$text) { throw $text }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
function Need([string]$cmd, [string]$wingetId, [string]$name) {
  if (Get-Command $cmd -ErrorAction SilentlyContinue) { return }
  Write-Host "   没有找到 $name。" -ForegroundColor Yellow
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $answer = Read-Host "   用 winget 安装 $name 吗？(Y/N)"
    if ($answer -match '^[Yy]') { winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements; Refresh-Path }
  }
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "请先安装 $name，然后重新运行本脚本。" }
}

try {
  $pkgName = 'dsh-island'
  $version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version

  Step '检查 Git、GitHub CLI、Node.js'
  Need git 'Git.Git' 'Git'
  Need gh 'GitHub.cli' 'GitHub CLI'
  Need npm 'OpenJS.NodeJS.LTS' 'Node.js'
  Done '工具齐全'

  Step '登录 GitHub（浏览器）'
  gh auth status --hostname github.com *> $null
  if ($LASTEXITCODE -ne 0) {
    gh auth login --hostname github.com --git-protocol https --web
    if ($LASTEXITCODE -ne 0) { Fail 'GitHub 登录没有完成。' }
  }
  gh auth setup-git *> $null
  $login = (gh api user --jq .login).Trim()
  $userId = (gh api user --jq .id).Trim()
  if (-not $login) { Fail '读取不到 GitHub 用户名。' }
  $repo = "$login/$pkgName"
  $url = "https://github.com/$repo"
  Done "已登录：$login"

  Step "准备仓库 $repo"
  node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.author=p.author||process.argv[1];p.repository={type:'git',url:'git+'+process.argv[2]+'.git'};p.homepage=process.argv[2]+'#readme';p.bugs={url:process.argv[2]+'/issues'};fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')" $login $url
  if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) { git init -b main | Out-Null }
  if (-not (git config user.name)) { git config user.name $login }
  if (-not (git config user.email)) { git config user.email "$userId+$login@users.noreply.github.com" }
  git add -A
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { git commit -q -m "DeepSeek Island $version"; if ($LASTEXITCODE -ne 0) { Fail 'git 提交失败。' } }
  gh repo view $repo *> $null
  if ($LASTEXITCODE -ne 0) {
    gh repo create $repo --public --description 'DeepSeek Harness desktop dynamic island plugin (community)' --homepage "https://www.npmjs.com/package/$pkgName" --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) { Fail "创建仓库 $repo 失败。" }
  } else {
    git remote get-url origin *> $null
    if ($LASTEXITCODE -ne 0) { git remote add origin "$url.git" }
    git push -u origin HEAD:main
    if ($LASTEXITCODE -ne 0) { Fail "推送到 $repo 失败：远端可能已有不同的提交。" }
  }
  git tag -f "v$version" | Out-Null
  git push -f origin "v$version" *> $null
  gh repo edit $repo --add-topic deepseek --add-topic deepseek-harness --add-topic dynamic-island --add-topic electron *> $null
  Done "GitHub：$url"

  Step '登录 npm（浏览器）'
  npm whoami *> $null
  if ($LASTEXITCODE -ne 0) {
    npm login --auth-type=web
    if ($LASTEXITCODE -ne 0) { Fail 'npm 登录没有完成。' }
  }
  $npmUser = (npm whoami).Trim()
  Done "已登录：$npmUser"

  Step "发布 $pkgName@$version 到 npm"
  $existing = (npm view "$pkgName@$version" version 2>$null)
  if ($existing) {
    Done "npm 上已经有 $version，跳过发布。"
  } else {
    $owner = (npm view $pkgName maintainers 2>$null)
    if ($owner -and ($owner -notmatch [regex]::Escape($npmUser))) { Fail "npm 上的 $pkgName 属于别人，请把 package.json 的 name 改成例如 @$npmUser/$pkgName 后重试。" }
    npm publish --access public
    if ($LASTEXITCODE -ne 0) { Fail 'npm 发布失败（如果开启了两步验证，请按提示在浏览器里确认后重试）。' }
  }
  Done "npm：https://www.npmjs.com/package/$pkgName"

  Write-Host ''
  Write-Host '全部完成！' -ForegroundColor Green
  Write-Host "  GitHub  $url"
  Write-Host "  npm     https://www.npmjs.com/package/$pkgName"
  Write-Host '  别人可以在 Harness 的「插件 › 添加插件」里输入 dsh-island 安装。'
} catch {
  Write-Host ''
  Write-Host "没有完成：$($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ''
Read-Host '按回车关闭'
