# StreamRelay — Dev startup script for Windows
$ErrorActionPreference = "Stop"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

function Test-PortListening([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Wait-Port([int]$Port, [int]$Seconds = 60) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-PortListening $Port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Wait-HttpOk([string]$Url, [int]$Seconds = 90) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}

Write-Host "=== StreamRelay — وضع التطوير ===" -ForegroundColor Cyan

# Create data dirs
New-Item -ItemType Directory -Force -Path data/hls, data/mpegts, data/logs | Out-Null

# Ensure .env exists
if (-not (Test-Path "$Root\.env")) {
    if (Test-Path "$Root\.env.example") {
        Copy-Item "$Root\.env.example" "$Root\.env"
        Write-Host "تم إنشاء .env من .env.example — راجع إعدادات PostgreSQL/Redis" -ForegroundColor Yellow
    } else {
        Write-Host "خطأ: ملف .env غير موجود" -ForegroundColor Red
        exit 1
    }
}

# Stop stale processes on dev ports
foreach ($port in @(3000, 5173)) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "تم تحرير المنفذ $port" -ForegroundColor Yellow
    }
}

# Start PostgreSQL + Redis via Docker if available
$dockerOk = $false
try {
    docker compose version 2>$null | Out-Null
    $dockerOk = $true
} catch { }

if ($dockerOk) {
    if (-not (Test-PortListening 5432) -or -not (Test-PortListening 6379)) {
        Write-Host "تشغيل PostgreSQL + Redis (docker-compose.dev.yml)..." -ForegroundColor Green
        docker compose -f docker-compose.dev.yml up -d
        if (-not (Wait-Port 5432 90)) {
            Write-Host "خطأ: PostgreSQL لم يبدأ على المنفذ 5432" -ForegroundColor Red
            exit 1
        }
        if (-not (Wait-Port 6379 60)) {
            Write-Host "خطأ: Redis لم يبدأ على المنفذ 6379" -ForegroundColor Red
            exit 1
        }
        Write-Host "PostgreSQL + Redis جاهزان ✓" -ForegroundColor Green
    } else {
        Write-Host "PostgreSQL + Redis يعملان ✓" -ForegroundColor Green
    }
} else {
    if (-not (Test-PortListening 5432)) {
        Write-Host ""
        Write-Host "خطأ: PostgreSQL غير شغّال على المنفذ 5432" -ForegroundColor Red
        Write-Host "  • ثبّت Docker Desktop ثم أعد تشغيل:" -ForegroundColor Yellow
        Write-Host "      winget install Docker.DockerDesktop" -ForegroundColor White
        Write-Host "  • أو شغّل يدوياً:" -ForegroundColor Yellow
        Write-Host "      docker compose -f docker-compose.dev.yml up -d" -ForegroundColor White
        Write-Host ""
        exit 1
    }
    if (-not (Test-PortListening 6379)) {
        Write-Host ""
        Write-Host "خطأ: Redis غير شغّال على المنفذ 6379" -ForegroundColor Red
        Write-Host "  شغّل: docker compose -f docker-compose.dev.yml up -d" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
}

# Start Backend
Write-Host "تشغيل Backend API على http://localhost:3000 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\backend'; npm start" -WindowStyle Normal

if (-not (Wait-HttpOk "http://localhost:3000/api/health" 90)) {
    Write-Host ""
    Write-Host "خطأ: Backend لم يستجب — راجع نافذة Terminal الخاصة بـ npm start" -ForegroundColor Red
    Write-Host "  غالباً: PostgreSQL/Redis غير متصلين أو كلمة مرور .env خاطئة" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
Write-Host "Backend جاهز ✓" -ForegroundColor Green

# Start Frontend
Write-Host "تشغيل Frontend على http://localhost:5173 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\frontend'; npm run dev" -WindowStyle Normal

if (-not (Wait-Port 5173 60)) {
    Write-Host "خطأ: Frontend لم يبدأ على المنفذ 5173" -ForegroundColor Red
    exit 1
}

$panelUrl = "http://localhost:5173/login"
Write-Host ""
Write-Host "=== جاهز — فتح اللوحة ===" -ForegroundColor Green
Write-Host "  الإدارة:   $panelUrl       (admin / admin123)" -ForegroundColor Cyan
Write-Host "  المشاهدة:  http://localhost:5173/watch/login" -ForegroundColor Cyan
Write-Host "  API:       http://localhost:3000/api/health" -ForegroundColor Cyan
Write-Host ""

Start-Process $panelUrl
