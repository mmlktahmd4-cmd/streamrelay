#!/bin/bash
# ─────────────────────────────────────────────────────────────
# StreamRelay — حذف كامل من السيرفر (كأنه ما اننصب)
#
# الاستخدام:
#   curl -fsSL .../wipe-server.sh | sudo bash
#   sudo bash scripts/wipe-server.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"

# مهم: إذا حُذف المجلد الحالي — لا تبقَ داخل /opt/streamrelay
cd / 2>/dev/null || cd /tmp 2>/dev/null || true

if [ "$EUID" -ne 0 ]; then
  echo "شغّل: sudo bash $0"
  exit 1
fi

echo "=============================================="
echo "  StreamRelay — حذف كامل"
echo "=============================================="

echo "[1/6] إيقاف systemd..."
systemctl stop streamrelay.service 2>/dev/null || true
systemctl disable streamrelay.service 2>/dev/null || true
rm -f /etc/systemd/system/streamrelay.service
systemctl daemon-reload 2>/dev/null || true

echo "[2/6] إيقاف Docker وحذف الحاويات..."
if [ -f "${INSTALL_DIR}/docker-compose.yml" ]; then
  docker compose -f "${INSTALL_DIR}/docker-compose.yml" down -v --remove-orphans 2>/dev/null || true
fi

for container in sr-postgres sr-redis sr-api sr-worker sr-frontend sr-nginx; do
  docker rm -f "$container" 2>/dev/null || true
done

echo "[3/6] حذف volumes وشبكة Docker..."
if command -v docker &>/dev/null; then
  docker volume ls -q 2>/dev/null | grep -E '^streamrelay_' | while read -r vol; do
    docker volume rm -f "$vol" 2>/dev/null || true
  done
  docker network rm streamrelay 2>/dev/null || true

  docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
    | grep -E '^(streamrelay-|.*streamrelay)' \
    | while read -r img; do
      docker rmi -f "$img" 2>/dev/null || true
    done
fi

echo "[4/6] حذف cron (watchdog)..."
if command -v crontab &>/dev/null; then
  crontab -l 2>/dev/null | grep -v streamrelay | crontab - 2>/dev/null || true
fi

echo "[5/6] حذف الملفات..."
rm -rf "${INSTALL_DIR}"
rm -rf /var/log/streamrelay
rm -f /tmp/streamrelay-env-backup-* /tmp/streamrelay-install.* 2>/dev/null || true

echo "[6/6] تحقق..."
left_containers="$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E '^sr-' || true)"
if [ -n "$left_containers" ]; then
  echo "تحذير: بقيت حاويات: $left_containers"
else
  echo "OK: لا توجد حاويات sr-*"
fi

if [ -d "${INSTALL_DIR}" ]; then
  echo "تحذير: ${INSTALL_DIR} ما زال موجوداً"
else
  echo "OK: ${INSTALL_DIR} محذوف"
fi

echo ""
echo "=============================================="
echo "  تم الحذف الكامل — السيرفر جاهز لتثبيت جديد"
echo "=============================================="
echo ""
echo "للتثبيت من جديد:"
echo "  curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/install-from-github.sh | sudo bash"
