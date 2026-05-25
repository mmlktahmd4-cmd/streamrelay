# StreamRelay - pack for Ubuntu 24 transfer
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Out = if ($args[0]) { $args[0] } else { "streamrelay-ubuntu24.tar.gz" }

Write-Host "=== Packing StreamRelay for Ubuntu ===" -ForegroundColor Cyan
Write-Host "Source: $Root"
Write-Host "Output: $Out"

if (Test-Path $Out) { Remove-Item $Out -Force }

tar -czf $Out `
  --exclude=./node_modules `
  --exclude=./backend/node_modules `
  --exclude=./frontend/node_modules `
  --exclude=./frontend/dist `
  --exclude=./data/hls `
  --exclude=./data/logs `
  --exclude=./.env `
  --exclude=./.git `
  --exclude=./*.tar.gz `
  .

$SizeMB = [math]::Round((Get-Item $Out).Length / 1MB, 1)
Write-Host ""
Write-Host "Created: $Out ($SizeMB MB)" -ForegroundColor Green
Write-Host ""
Write-Host "On Ubuntu 24:"
Write-Host "  sudo mkdir -p /opt/streamrelay"
Write-Host "  sudo tar -xzf $Out -C /opt/streamrelay"
Write-Host "  cd /opt/streamrelay"
Write-Host "  sudo bash scripts/ubuntu-quick-install.sh"
