#!/bin/bash
# ─────────────────────────────────────────────────────────────
# StreamRelay — تجهيز المشروع للنقل إلى Ubuntu (بدون node_modules)
# شغّله من مجلد المشروع:  bash scripts/pack-for-transfer.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${1:-streamrelay-ubuntu24.tar.gz}"

echo "=== تجهيز حزمة النقل ==="
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
echo "انقل الملف إلى Ubuntu 24 ثم:"
echo "  tar -xzf $OUT -C /opt/streamrelay --strip-components=0"
echo "  cd /opt/streamrelay && sudo bash scripts/ubuntu-quick-install.sh"
