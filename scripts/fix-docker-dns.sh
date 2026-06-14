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

echo "[2] ضبط DNS عام لـ Docker إن لزم..."
# اجبر التطبيق حتى لو لم يكن resolv.conf على 127.x (مفيد لو فشل السحب لأسباب DNS أخرى)
cfg="/etc/docker/daemon.json"
mkdir -p /etc/docker
if [ -f "$cfg" ] && grep -q '"dns"' "$cfg" 2>/dev/null; then
  echo "  daemon.json يحتوي DNS بالفعل — تخطّي."
else
  if [ -f "$cfg" ] && command -v python3 >/dev/null 2>&1; then
    python3 - "$cfg" <<'PY' || true
import json, sys
p = sys.argv[1]
try:
    with open(p) as f:
        d = json.load(f)
    if not isinstance(d, dict):
        d = {}
except Exception:
    d = {}
d.setdefault("dns", ["8.8.8.8", "1.1.1.1"])
with open(p, "w") as f:
    json.dump(d, f, indent=2)
PY
  else
    cat > "$cfg" <<'JSON'
{
  "dns": ["8.8.8.8", "1.1.1.1"]
}
JSON
  fi
  echo "  تم تحديث $cfg"
  echo "  إعادة تشغيل Docker..."
  systemctl restart docker 2>/dev/null || service docker restart 2>/dev/null || true
  sleep 4
fi

echo ""
echo "[3] اختبار سحب صورة node:20-alpine..."
if docker pull node:20-alpine >/dev/null 2>&1; then
  echo "  ✓ نجح سحب الصورة — DNS سليم الآن."
else
  echo "  ✗ ما زال السحب يفشل. تحقق يدوياً:"
  echo "    cat /etc/resolv.conf"
  echo "    docker run --rm alpine nslookup registry-1.docker.io"
  exit 1
fi

echo ""
echo "[4] إعادة تشغيل التحديث..."
if [ -f "${SCRIPT_DIR}/deploy-update.sh" ]; then
  bash "${SCRIPT_DIR}/deploy-update.sh"
  echo ""
  echo "=== تم ✓ — أعد فحص اللوحة ==="
else
  echo "  شغّل: cd $INSTALL_DIR && sudo bash scripts/deploy-update.sh"
fi
