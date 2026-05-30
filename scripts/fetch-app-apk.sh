#!/usr/bin/env bash
# ينزّل أحدث نسخة من تطبيق الأندرويد (StreamRelay.apk) من إصدار GitHub (app-latest)
# إلى public/app/ ليخدمها API محلياً عبر /api/app/download.
# آمن: لا يفشل التثبيت إن لم يكن الإصدار متوفراً بعد (best-effort).
set -uo pipefail

INSTALL_DIR="${1:-/opt/streamrelay}"
DEST_DIR="${INSTALL_DIR}/public/app"
DEST="${DEST_DIR}/StreamRelay.apk"

mkdir -p "$DEST_DIR"

# استخرج owner/repo من remote origin، مع قيمة افتراضية
REMOTE="$(git -C "$INSTALL_DIR" config --get remote.origin.url 2>/dev/null || true)"
REPO="$(echo "$REMOTE" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
[ -z "$REPO" ] && REPO="mmlktahmd4-cmd/streamrelay"

URL="https://github.com/${REPO}/releases/download/app-latest/StreamRelay.apk"
echo "تنزيل تطبيق الأندرويد من: ${URL}"

if curl -fsSL --connect-timeout 15 -o "${DEST}.tmp" "$URL"; then
  mv -f "${DEST}.tmp" "$DEST"
  echo "تم حفظ التطبيق في: ${DEST}"
else
  rm -f "${DEST}.tmp" 2>/dev/null || true
  echo "تحذير: تعذّر تنزيل APK (قد لا يكون مرفوعاً بعد أو لا يوجد إنترنت) — تخطٍّ."
fi
