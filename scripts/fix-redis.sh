#!/bin/bash
# إصلاح sr-redis unhealthy — تعارض منفذ 6379 أو volume تالف
# الاستخدام: cd /opt/streamrelay && sudo bash scripts/fix-redis.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$INSTALL_DIR"

# shellcheck source=common-install.sh
source "${SCRIPT_DIR}/common-install.sh"

echo "=== StreamRelay — إصلاح Redis ==="
echo ""

echo "[1] إيقاف redis-server على المضيف (إن وُجد)..."
stop_host_db_redis_conflicts

if ss -tln 2>/dev/null | grep -q ':6379 '; then
  echo "  تحذير: المنفذ 6379 ما زال مشغولاً:"
  ss -tlnp 2>/dev/null | grep ':6379 ' || true
  echo "  أوقف الخدمة يدوياً ثم أعد تشغيل هذا السكربت."
fi

echo "[2] سحب آخر docker-compose.yml من GitHub (إن وُجد git)..."
if [ -d .git ]; then
  git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
  git fetch origin main 2>/dev/null && git checkout origin/main -- docker-compose.yml 2>/dev/null || true
fi

echo "[3] إعادة إنشاء حاوية Redis..."
reset_redis_volume
docker compose up -d postgres redis

echo "[4] انتظار Redis..."
if wait_for_redis 40 2; then
  echo ""
  echo "✓ Redis جاهز — إعادة تشغيل باقي الخدمات..."
  docker compose up -d
  docker compose ps
  echo ""
  echo "=== تم ✓ ==="
else
  echo ""
  echo "✗ Redis ما زال unhealthy — انسخ هذا السجل:"
  docker compose logs redis --tail 50 2>&1 || true
  exit 1
fi
