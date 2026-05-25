# StreamRelay — رفع المشروع على GitHub
# شغّل بعد تسجيل الدخول:  gh auth login
param(
  [string]$RepoName = "streamrelay",
  [ValidateSet("public", "private")]
  [string]$Visibility = "private"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "=== StreamRelay — GitHub Publish ===" -ForegroundColor Cyan

# تحقق من gh
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "GitHub CLI غير مثبت. ثبّته: winget install GitHub.cli" -ForegroundColor Red
  exit 1
}

$auth = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "يجب تسجيل الدخول أولاً:" -ForegroundColor Yellow
  Write-Host "  gh auth login" -ForegroundColor White
  Write-Host ""
  gh auth login --hostname github.com --git-protocol https --web
}

if (-not (Test-Path ".git")) {
  git init
  git branch -M main
}

git add .
$status = git status --porcelain
if ($status) {
  git commit -m "Update StreamRelay IPTV platform"
}

Write-Host "إنشاء المستودع ورفع الكود..." -ForegroundColor Cyan
gh repo create $RepoName --$Visibility --source=. --remote=origin --push --description "StreamRelay IPTV - HLS relay, admin dashboard, viewer portal"

if ($LASTEXITCODE -eq 0) {
  $url = gh repo view --json url -q .url
  Write-Host ""
  Write-Host "Done! Repository published." -ForegroundColor Green
  Write-Host "  $url"
  Write-Host ""
  Write-Host "Ubuntu install:"
  Write-Host "  sudo git clone ${url}.git /opt/streamrelay"
  Write-Host "  cd /opt/streamrelay && sudo bash scripts/ubuntu-quick-install.sh"
} else {
  Write-Host "Push failed - repo may already exist. Try:" -ForegroundColor Yellow
  Write-Host ('  git remote add origin https://github.com/YOUR_USER/' + $RepoName + '.git')
  Write-Host "  git push -u origin main"
}
