#!/bin/bash
# فحص المنافذ قبل/بعد تثبيت StreamRelay على Ubuntu 22/24
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/network.sh
source "$SCRIPT_DIR/lib/network.sh"

check_port() {
  local port="$1"
  local label="$2"
  if ss -tln 2>/dev/null | grep -q ":${port} "; then
    local proc
    proc="$(ss -tlnp 2>/dev/null | grep ":${port} " | head -1 || true)"
    echo "  [مشغول] ${port} — ${label}"
    [ -n "$proc" ] && echo "         $proc"
  else
    echo "  [متاح]  ${port} — ${label}"
  fi
}

echo "=== StreamRelay — فحص المنافذ ==="
echo ""

if [ -f /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "النظام: ${PRETTY_NAME:-unknown}"
  echo ""
fi

echo "منافذ StreamRelay:"
check_port 80   "HTTP (Nginx — StreamRelay)"
check_port 8080 "HTTP بديل (Apache مشغول)"
check_port 443  "HTTPS (Apache/Nginx)"
check_port 3000 "API (قديم — لم يعد مطلوباً على المضيف)"
check_port 5432 "PostgreSQL (قديم على المضيف)"
check_port 6379 "Redis (قديم على المضيف)"
check_port 5173 "Frontend (داخلي فقط)"
check_port 1935 "RTMP"

echo ""
if [ -f /opt/streamrelay/.env ]; then
  HTTP_PORT="$(grep '^STREAMRELAY_HTTP_PORT=' /opt/streamrelay/.env | cut -d= -f2- || echo 80)"
  BASE="$(grep '^PUBLIC_BASE_URL=' /opt/streamrelay/.env | cut -d= -f2- || echo unknown)"
  echo "إعداد StreamRelay:"
  echo "  STREAMRELAY_HTTP_PORT=${HTTP_PORT}"
  echo "  PUBLIC_BASE_URL=${BASE}"
  echo ""
fi

if command -v docker &>/dev/null && [ -d /opt/streamrelay ]; then
  echo "حالة Docker:"
  (cd /opt/streamrelay && docker compose ps 2>/dev/null) || true
fi

echo ""
echo "إذا 80 مشغول: sudo bash scripts/ubuntu-quick-install.sh يستخدم 8080 تلقائياً"
