#!/bin/bash
# إصلاح فشل تحديث اللوحة: "lookup registry-1.docker.io on 127.0.0.x"
# السبب: DNS المضيف محلّل محلي (loopback) لا تصله حاويات Docker أثناء البناء/السحب.
# الاستخدام: cd /opt/streamrelay && sudo bash scripts/fix-docker-dns.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$EUID" -ne 0 ]; then
  echo "شغّل كـ root: sudo bash scripts/fix-docker-dns.sh"
  exit 1
fi

cd "$INSTALL_DIR"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common-install.sh"

echo "=== StreamRelay — إصلاح DNS الخاص بـ Docker ==="
echo ""
echo "[1] DNS الحالي على المضيف:"
grep -E '^[[:space:]]*nameserver' /etc/resolv.conf 2>/dev/null || echo "  (لا يوجد)"
echo ""

echo "[2] إصلاح DNS لـ Docker (متحقَّق منه)..."
if ! ensure_docker_dns; then
  echo ""
  echo "  ✗ تعذّر إصلاح DNS تلقائياً. تحقق يدوياً:"
  echo "    cat /etc/resolv.conf"
  echo "    cat /etc/docker/daemon.json"
  echo "    docker pull node:20-alpine"
  exit 1
fi

echo ""
echo "[3] إعادة تشغيل التحديث..."
if [ -f "${SCRIPT_DIR}/deploy-update.sh" ]; then
  bash "${SCRIPT_DIR}/deploy-update.sh"
  echo ""
  echo "=== تم ✓ — أعد فحص اللوحة ==="
else
  echo "  شغّل: cd $INSTALL_DIR && sudo bash scripts/deploy-update.sh"
fi
