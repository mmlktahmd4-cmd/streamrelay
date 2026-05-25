#!/bin/bash
# يثبّت IP السيرفر الداخلي ويعيد تشغيل الحاويات
# الاستخدام:
#   sudo bash scripts/fix-server-ip.sh
#   sudo bash scripts/fix-server-ip.sh --no-restart   # تحديث .env فقط
set -euo pipefail

NO_RESTART="${1:-}"

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
cd "$INSTALL_DIR"

SERVER_IP="$(hostname -I | tr ' ' '\n' | grep '^192\.168\.' | head -1)"
SERVER_IP="${SERVER_IP:-$(hostname -I | tr ' ' '\n' | grep -v '^172\.' | head -1)}"
SERVER_IP="${SERVER_IP:-$(hostname -I | awk '{print $1}')}"
SERVER_LAN_SUBNET="$(echo "$SERVER_IP" | awk -F. '{print $1"."$2"."$3".0/24}')"
HTTP_PORT="$(grep '^STREAMRELAY_HTTP_PORT=' .env 2>/dev/null | cut -d= -f2- || echo 80)"
HTTP_PORT="${HTTP_PORT:-80}"

if [ "$HTTP_PORT" = "80" ]; then
  BASE_URL="http://${SERVER_IP}"
else
  BASE_URL="http://${SERVER_IP}:${HTTP_PORT}"
fi

echo "=== IP السيرفر: ${SERVER_IP} ==="
echo "=== الشبكة: ${SERVER_LAN_SUBNET} ==="
echo "=== الرابط: ${BASE_URL} ==="

set_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    echo "${key}=${val}" >> .env
  fi
}

set_env SERVER_IP "$SERVER_IP"
set_env SERVER_LAN_SUBNET "$SERVER_LAN_SUBNET"
set_env PUBLIC_BASE_URL "$BASE_URL"
set_env HLS_BASE_URL "${BASE_URL}/hls"
set_env RTMP_INGEST_URL "rtmp://${SERVER_IP}:1935/live"

if [ "$NO_RESTART" = "--no-restart" ]; then
  echo "=== تم تحديث .env (بدون إعادة تشغيل) ==="
  exit 0
fi

echo "=== إعادة تشغيل Docker ==="
docker compose up -d --force-recreate api worker nginx

echo ""
echo "تم! افتح: ${BASE_URL}/watch/login"
