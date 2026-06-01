#!/bin/bash
# تحديث آمن من GitHub — يحافظ على .env والبيانات وDocker volumes
# الاستخدام: cd /opt/streamrelay && sudo bash scripts/safe-update.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"

if [ "$EUID" -ne 0 ]; then
  echo "شغّل: sudo bash scripts/safe-update.sh"
  exit 1
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "المشروع غير مثبت عبر git — استخدم easy-install.sh"
  exit 1
fi

echo "=== StreamRelay — تحديث آمن ==="
echo "• يحافظ على: .env, INSTALL-CREDENTIALS.txt, قاعدة البيانات, ملفات البث"
echo ""

# نسخ احتياطي سريع
BACKUP="/tmp/streamrelay-env-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP"
[ -f "$INSTALL_DIR/.env" ] && cp "$INSTALL_DIR/.env" "$BACKUP/.env"
[ -f "$INSTALL_DIR/.streamrelay-network" ] && cp "$INSTALL_DIR/.streamrelay-network" "$BACKUP/"
[ -f "$INSTALL_DIR/INSTALL-CREDENTIALS.txt" ] && cp "$INSTALL_DIR/INSTALL-CREDENTIALS.txt" "$BACKUP/"
echo "نسخة احتياطية: $BACKUP"

git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

cd "$INSTALL_DIR"
chmod +x scripts/*.sh 2>/dev/null || true

echo ""
echo "=== git pull ==="
# shellcheck source=lib/network.sh
source "$INSTALL_DIR/scripts/lib/network.sh"
sync_install_repo "$INSTALL_DIR" "$(git branch --show-current)"

echo ""
echo "=== تطبيق التحديث ==="
bash scripts/update-from-github.sh

echo ""
echo "=== تم — لم تُفقد إعداداتك ==="
echo "• إن وُجدت سيرفرات بعيدة ببيانات SSH، يُحدَّثون تلقائياً بعد اكتمال بناء الرئيسي"
[ -f "$BACKUP/.env" ] && echo "النسخة الاحتياطية: $BACKUP/.env"
