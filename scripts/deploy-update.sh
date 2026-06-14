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

# تأكد من وجود وحدة تطبيق الشبكة (للأنظمة المثبّتة قبل هذه الميزة)
if declare -F install_network_apply_unit >/dev/null 2>&1; then
  install_network_apply_unit || true
fi

# تأكد من وجود وحدة تحديث اللوحة (تسمح بالتحديث من اللوحة بضغطة — للأنظمة المثبّتة قبل هذه الميزة)
if declare -F install_update_apply_unit >/dev/null 2>&1; then
  install_update_apply_unit || true
fi

echo "=== تنزيل تطبيق الأندرويد (إن توفّر إصدار) ==="
bash "${SCRIPT_DIR}/fetch-app-apk.sh" "$INSTALL_DIR" || true

echo "=== التأكد من DNS الخاص بـ Docker (يمنع فشل سحب الصور) ==="
ensure_docker_dns || true

echo "=== بناء الواجهة ==="
build_frontend

echo "=== بناء API و Worker (حزم جديدة مثل ssh2) ==="
docker compose build api worker

if [ -f "${SCRIPT_DIR}/fix-server-ip.sh" ]; then
  echo "=== مزامنة IP الشبكة ==="
  bash "${SCRIPT_DIR}/fix-server-ip.sh" --no-restart || true
fi

echo "=== إعادة تشغيل الحاويات ==="
docker compose up -d postgres redis
docker compose up -d --force-recreate api worker frontend nginx

echo "=== انتظار API ==="
if ! wait_for_api 30 2; then
  echo "تحذير: تحقق من السجل: docker compose logs api --tail 50"
fi

if [ "${AUTO_UPDATE_REMOTES:-1}" = "1" ]; then
  echo ""
  echo "=== تحديث سيرفرات البث البعيدة (SSH + GitHub) ==="
  if docker compose exec -T api node src/scripts/sync-remote-workers.js; then
    echo "تم تحديث السيرفرات البعيدة (إن وُجدت بيانات SSH)"
  else
    echo "تحذير: فشل تحديث سيرفر بعيد واحد أو أكثر — من لوحة الإدارة:"
    echo "  السيرفرات → «تحديث السيرفرات البعيدة»"
    echo "  أو: docker compose exec -T api node src/scripts/sync-remote-workers.js"
  fi
else
  echo "تخطي تحديث البعيد (AUTO_UPDATE_REMOTES=0) — استخدم لوحة الإدارة → تحديث السيرفرات البعيدة"
fi

print_streamrelay_urls
