#!/bin/bash
# تشخيص جاهزية السيرفر الرئيسي للربط التلقائي
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
cd "$INSTALL_DIR" 2>/dev/null || cd /opt/streamrelay

echo "=== StreamRelay — تشخيص الربط التلقائي (السيرفر الرئيسي) ==="
echo ""

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

SERVER_IP="${SERVER_IP:-}"
STREAMRELAY_HTTP_PORT="${STREAMRELAY_HTTP_PORT:-80}"
POSTGRES_PUBLISH="${POSTGRES_PUBLISH:-127.0.0.1:5432}"
REDIS_PUBLISH="${REDIS_PUBLISH:-127.0.0.1:6379}"

echo "SERVER_IP=${SERVER_IP:-<غير مضبوط>}"
echo "STREAMRELAY_HTTP_PORT=${STREAMRELAY_HTTP_PORT}"
echo "POSTGRES_PUBLISH=${POSTGRES_PUBLISH}"
echo "REDIS_PUBLISH=${REDIS_PUBLISH}"
echo ""

echo "--- حاويات ---"
docker compose ps 2>/dev/null || true
echo ""

echo "--- API: حزمة ssh2 ---"
if docker compose exec -T api node -e "import('ssh2').then(()=>console.log('ssh2 OK')).catch(e=>{console.error(e.message);process.exit(1)})" 2>/dev/null; then
  echo "OK"
else
  echo "FAIL — نفّذ: docker compose build api && docker compose up -d api"
fi
echo ""

echo "--- سكربت الربط ---"
for p in /opt/streamrelay-scripts/provision-stream-worker.sh scripts/provision-stream-worker.sh; do
  if [ -f "$p" ]; then
    echo "OK: $p"
  fi
done
echo ""

echo "--- منافذ Postgres/Redis ---"
ss -tlnp 2>/dev/null | grep -E ':5432|:6379' || netstat -tlnp 2>/dev/null | grep -E ':5432|:6379' || true
echo ""

echo "--- اختبار من داخل API (MASTER_IP للبعيد) ---"
docker compose exec -T api node -e "
  const ip = process.env.SERVER_IP || '127.0.0.1';
  console.log('SERVER_IP in api:', ip);
" 2>/dev/null || true

echo ""
echo "إذا POSTGRES_PUBLISH=127.0.0.1 — السيرفرات البعيدة لن تتصل."
echo "أضف في .env:"
echo "  POSTGRES_PUBLISH=0.0.0.0:5432"
echo "  REDIS_PUBLISH=0.0.0.0:6379"
echo "ثم: docker compose up -d postgres redis"
