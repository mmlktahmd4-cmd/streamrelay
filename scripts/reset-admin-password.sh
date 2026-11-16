#!/bin/bash
# مزامنة كلمة مرور admin من .env مع قاعدة البيانات
# الاستخدام: sudo bash scripts/reset-admin-password.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"

if [ "$EUID" -ne 0 ]; then
  echo "شغّل كـ root: sudo bash scripts/reset-admin-password.sh"
  exit 1
fi

if [ ! -f "$INSTALL_DIR/.env" ]; then
  echo "لم يُعثر على $INSTALL_DIR/.env"
  exit 1
fi

cd "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/network.sh
source "${SCRIPT_DIR}/lib/network.sh" 2>/dev/null || true

grep -q '^ADMIN_SYNC_PASSWORD=' .env \
  && sed -i 's|^ADMIN_SYNC_PASSWORD=.*|ADMIN_SYNC_PASSWORD=true|' .env \
  || echo "ADMIN_SYNC_PASSWORD=true" >> .env

set -a
# shellcheck disable=SC1091
source .env
set +a

echo "مزامنة كلمة مرور admin من .env ..."
docker compose build api worker
docker compose up -d api worker
for i in $(seq 1 30); do
  if docker compose exec -T api wget -qO- "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker compose restart api worker >/dev/null
sleep 5

ADMIN_PASS="$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"
BASE_URL="${PUBLIC_BASE_URL:-http://$(detect_server_ip)}"

cat > "${INSTALL_DIR}/INSTALL-CREDENTIALS.txt" <<CRED
StreamRelay — بيانات التثبيت
التاريخ: $(date -Iseconds)
العنوان: ${BASE_URL}
admin / ${ADMIN_PASS}
CRED
chmod 600 "${INSTALL_DIR}/INSTALL-CREDENTIALS.txt"

echo ""
echo "تمت المزامنة."
echo "  المستخدم: admin"
echo "  كلمة المرور: ${ADMIN_PASS}"
echo "  لوحة الإدارة: ${BASE_URL}/login"
echo ""
