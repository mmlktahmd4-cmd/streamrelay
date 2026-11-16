#!/bin/bash
# يطبّق طلب «الرجوع للنسخة السابقة» من لوحة الإدارة
set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
REQUEST_FILE="${INSTALL_DIR}/.update-rollback-request"

[ -f "$REQUEST_FILE" ] || exit 0
rm -f "$REQUEST_FILE" 2>/dev/null || true

if [ "$EUID" -ne 0 ]; then
  echo "خطأ: يجب التشغيل كـ root" >&2
  exit 1
fi

bash "${INSTALL_DIR}/scripts/rollback-update.sh"
