#!/bin/bash
# يثبّت IP السيرفر الداخلي ويعيد تشغيل الحاويات
# الاستخدام:
#   sudo bash scripts/fix-server-ip.sh
#   sudo bash scripts/fix-server-ip.sh --no-restart   # تحديث .env فقط
set -euo pipefail

NO_RESTART="${1:-}"
INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib/network.sh
source "${SCRIPT_DIR}/lib/network.sh"

cd "$INSTALL_DIR"

SERVER_IP="$(resolve_server_ip "$INSTALL_DIR")"
SERVER_LAN_SUBNET="$(ip_to_subnet "$SERVER_IP")"
HTTP_PORT="$(read_http_port "$INSTALL_DIR")"
BASE_URL="$(sync_env_public_urls "$INSTALL_DIR" "$SERVER_IP" "$HTTP_PORT")"

if grep -q '^SERVER_LAN_SUBNET=' .env 2>/dev/null; then
  sed -i "s|^SERVER_LAN_SUBNET=.*|SERVER_LAN_SUBNET=${SERVER_LAN_SUBNET}|" .env
else
  echo "SERVER_LAN_SUBNET=${SERVER_LAN_SUBNET}" >> .env
fi

echo "=== IP السيرفر: ${SERVER_IP} ==="
echo "=== الشبكة: ${SERVER_LAN_SUBNET} ==="
echo "=== المنفذ: ${HTTP_PORT} ==="
echo "=== الرابط: ${BASE_URL} ==="
echo "=== لوحة الإدارة: ${BASE_URL}/login ==="

if [ "$NO_RESTART" = "--no-restart" ]; then
  echo "=== تم تحديث .env (بدون إعادة تشغيل) ==="
  exit 0
fi

echo "=== إعادة تشغيل Docker ==="
docker compose up -d --force-recreate api worker nginx

echo ""
echo "تم! افتح: ${BASE_URL}/watch/login"
