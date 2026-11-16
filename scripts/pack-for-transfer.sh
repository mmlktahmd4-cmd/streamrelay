#!/bin/bash
# ─────────────────────────────────────────────────────────────
# StreamRelay — تجهيز المشروع للنقل إلى Ubuntu 22/24
# شغّله من مجلد المشروع:  bash scripts/pack-for-transfer.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${1:-streamrelay-ubuntu.tar.gz}"

echo "=== تجهيز حزمة النقل (Ubuntu 22/24) ==="
echo "المجلد: $ROOT"
echo "الملف:  $OUT"

tar -czf "$OUT" \
  --exclude='./node_modules' \
  --exclude='./backend/node_modules' \
  --exclude='./frontend/node_modules' \
  --exclude='./frontend/dist' \
  --exclude='./data/hls/*' \
  --exclude='./data/logs/*' \
  --exclude='./data/vod/*' \
  --exclude='./.env' \
  --exclude='./.git' \
  --exclude='./*.tar.gz' \
  .

SIZE=$(du -h "$OUT" | cut -f1)
echo ""
echo "تم إنشاء: $OUT ($SIZE)"
echo ""
echo "على Ubuntu 22:"
echo "  sudo mkdir -p /opt/streamrelay"
echo "  sudo tar -xzf $OUT -C /opt/streamrelay"
echo "  cd /opt/streamrelay && sudo bash scripts/ubuntu-quick-install.sh"
