#!/bin/bash
# بناء ونشر StreamRelay بعد تحديث الكود
# الاستخدام: sudo bash scripts/deploy-update.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$EUID" -ne 0 ]; then
  echo "شغّل كـ root: sudo bash scripts/deploy-update.sh"
  exit 1
fi

cd "$INSTALL_DIR"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common-install.sh"

echo "=== بناء الواجهة ==="
build_frontend

echo "=== إعادة تشغيل الحاويات ==="
docker compose up -d --force-recreate api worker frontend nginx

echo "=== انتظار API ==="
if ! wait_for_api 30 2; then
  echo "تحذير: تحقق من السجل: docker compose logs api --tail 50"
fi

print_streamrelay_urls
