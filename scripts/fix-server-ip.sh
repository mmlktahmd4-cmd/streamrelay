#!/bin/bash
# يثبّت IP السيرفر ويحدّث روابط .env
# الاستخدام:
#   sudo bash scripts/fix-server-ip.sh
#   sudo bash scripts/fix-server-ip.sh 213.210.20.39
#   sudo bash scripts/fix-server-ip.sh --detect
#   sudo bash scripts/fix-server-ip.sh --no-restart
set -euo pipefail

NO_RESTART=""
FORCE_DETECT=0
EXPLICIT_IP=""
INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for arg in "$@"; do
  case "$arg" in
    --no-restart) NO_RESTART="1" ;;
    --detect) FORCE_DETECT=1 ;;
    *)
      if [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        EXPLICIT_IP="$arg"
      fi
      ;;
  esac
done

# shellcheck source=lib/network.sh
source "${SCRIPT_DIR}/lib/network.sh"

cd "$INSTALL_DIR"

if [ -n "$EXPLICIT_IP" ]; then
  SERVER_IP="$EXPLICIT_IP"
elif [ "$FORCE_DETECT" = "1" ]; then
  SERVER_IP="$(detect_server_ip)"
else
  OLD_IP="$(read_env_value SERVER_IP "$INSTALL_DIR")"
  SERVER_IP="$(resolve_server_ip "$INSTALL_DIR")"
  if [ -n "$OLD_IP" ] && [ "$OLD_IP" != "$SERVER_IP" ]; then
    echo "=== IP قديم غير موجود على الجهاز: ${OLD_IP} → ${SERVER_IP} ==="
  fi
fi

HTTP_PORT="$(read_http_port "$INSTALL_DIR")"
BASE_URL="$(sync_env_public_urls "$INSTALL_DIR" "$SERVER_IP" "$HTTP_PORT")"
SERVER_LAN_SUBNET="$(subnet_for_ip "$SERVER_IP")"

echo "=== IP السيرفر: ${SERVER_IP} ==="
if [ -n "$SERVER_LAN_SUBNET" ]; then
  echo "=== الشبكة: ${SERVER_LAN_SUBNET} ==="
else
  echo "=== الشبكة: (IP عام — بدون SERVER_LAN_SUBNET) ==="
fi
echo "=== المنفذ: ${HTTP_PORT} ==="
echo "=== الرابط: ${BASE_URL} ==="
echo "=== لوحة الإدارة: ${BASE_URL}/login ==="

if [ -n "$NO_RESTART" ]; then
  echo "=== تم تحديث .env (بدون إعادة تشغيل) ==="
  exit 0
fi

echo "=== إعادة تشغيل Docker (بدون worker — تبقى القنوات تعمل) ==="
# لا نعيد إنشاء worker: عمليات FFmpeg أبناء له وستُقتل عند إعادة إنشائه.
# api يحدّث روابط البث في قاعدة البيانات، و worker يلتقط التغيير تلقائياً.
docker compose up -d --force-recreate api nginx

echo ""
echo "تم! افتح: ${BASE_URL}/watch/login"
echo "القنوات تستمر بالعمل — لا حاجة لإيقافها."
