# StreamRelay — Dev startup script for Windows
$ErrorActionPreference = "Stop"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host "=== StreamRelay Dev Mode ===" -ForegroundColor Cyan

# Create data dirs
New-Item -ItemType Directory -Force -Path data/hls, data/mpegts, data/logs | Out-Null

# Stop stale processes on dev ports
foreach ($port in @(3000, 5173)) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "Freed port $port" -ForegroundColor Yellow
    }
}

# Check PostgreSQL + Redis
try {
    $pg = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
    $redis = Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue
    if (-not $pg) { Write-Host "WARNING: PostgreSQL not running on 5432" -ForegroundColor Red }
    if (-not $redis) { Write-Host "WARNING: Redis not running on 6379" -ForegroundColor Red }
} catch { }

# Start Backend (npm start — stable on Node 24)
Write-Host "Starting Backend API on http://localhost:3000 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\backend'; npm start" -WindowStyle Normal

Start-Sleep -Seconds 4

# Start Frontend
Write-Host "Starting Frontend on http://localhost:5173 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\frontend'; npm run dev" -WindowStyle Normal

Start-Sleep -Seconds 5

Write-Host ""
Write-Host "=== Ready ===" -ForegroundColor Green
Write-Host "Viewer:  http://localhost:5173/watch/login  (viewer1 / viewer1234)" -ForegroundColor Cyan
Write-Host "Admin:   http://localhost:5173/login       (admin / admin123)" -ForegroundColor Cyan
Write-Host "API:     http://localhost:3000" -ForegroundColor Cyan
