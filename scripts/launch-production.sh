#!/bin/bash
# إطلاق StreamRelay للإنتاج — بناء الواجهة + Docker
# الاستخدام: sudo bash scripts/launch-production.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$EUID" -ne 0 ]; then
  echo "شغّل كـ root: sudo bash scripts/launch-production.sh"
  exit 1
fi

cd "$INSTALL_DIR"

# إيقاف أي واجهة مؤقتة قديمة
systemctl --user stop streamrelay-frontend.service 2>/dev/null || true
systemctl --user disable streamrelay-frontend.service 2>/dev/null || true
pkill -f 'serve -s . -l 8888' 2>/dev/null || true
pkill -f 'http.server 8888' 2>/dev/null || true

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common-install.sh"

echo "=== تحديث IP الشبكة ==="
bash "${SCRIPT_DIR}/fix-server-ip.sh" --no-restart

echo "=== بناء ونشر ==="
build_frontend
docker compose up -d --force-recreate api worker frontend nginx

if ! wait_for_api 30 2; then
  echo "تحذير: API لم يستجب — راجع docker compose logs api"
fi

curl -sf http://127.0.0.1/nginx-health >/dev/null || true
print_streamrelay_urls
