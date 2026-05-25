#!/bin/bash
# StreamRelay — حذف كامل وإعادة تثبيت من GitHub (Ubuntu)
# الاستخدام: sudo bash fresh-install-server.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"

if [ "$EUID" -ne 0 ]; then
  echo "شغّل: sudo bash $0"
  exit 1
fi

echo "=============================================="
echo "  StreamRelay — حذف وإعادة تثبيت"
echo "  السيرفر: $(hostname -I 2>/dev/null | cut -d' ' -f1)"
echo "=============================================="

if [ -d "$INSTALL_DIR" ]; then
  echo "[1/3] إيقاف وحذف التثبيت القديم..."
  cd / || cd /tmp
  if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    docker compose -f "$INSTALL_DIR/docker-compose.yml" down -v 2>/dev/null || true
  fi
  rm -rf "$INSTALL_DIR"
  echo "      تم حذف $INSTALL_DIR"
else
  echo "[1/3] لا يوجد تثبيت سابق في $INSTALL_DIR"
fi

echo "[2/3] تثبيت جديد من GitHub..."
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/easy-install.sh | bash

echo "[3/3] تحقق..."
if grep -q 'install-scripts: 2026.05.26-awkfix3' "$INSTALL_DIR/scripts/ubuntu-quick-install.sh" 2>/dev/null; then
  echo "OK: نسخة awkfix موجودة في السكriptات"
fi
docker compose -f "$INSTALL_DIR/docker-compose.yml" ps 2>/dev/null || true

echo ""
echo "انتهى. افتح: http://$(hostname -I 2>/dev/null | cut -d' ' -f1)/login"
echo "بيانات الدخول: $INSTALL_DIR/INSTALL-CREDENTIALS.txt"
