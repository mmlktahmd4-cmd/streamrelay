#!/bin/bash
# الرجوع لآخر نسخة قبل التحديث (اللوحة الرئيسية)
# الاستخدام: sudo bash scripts/rollback-update.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREV_FILE="${INSTALL_DIR}/.update-previous-commit"
STATUS_FILE="${INSTALL_DIR}/.update-status"
LOG_FILE="${INSTALL_DIR}/.update.log"

if [ "$EUID" -ne 0 ]; then
  echo "شغّل كـ root: sudo bash scripts/rollback-update.sh"
  exit 1
fi

if [ ! -f "$PREV_FILE" ]; then
  echo "لا توجد نسخة سابقة محفوظة — يُحفظ commit قبل كل تحديث من اللوحة."
  exit 1
fi

PREV_COMMIT=""
PREV_LABEL=""
if command -v python3 >/dev/null 2>&1; then
  PREV_COMMIT="$(python3 -c "import json; d=json.load(open('$PREV_FILE')); print(d.get('commit',''))" 2>/dev/null || true)"
  PREV_LABEL="$(python3 -c "import json; d=json.load(open('$PREV_FILE')); print(d.get('label',''))" 2>/dev/null || true)"
fi
if [ -z "$PREV_COMMIT" ]; then
  PREV_COMMIT="$(grep -o '"commit"[[:space:]]*:[[:space:]]*"[^"]*"' "$PREV_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
fi

if [ -z "$PREV_COMMIT" ]; then
  echo "تعذّر قراءة commit السابق من $PREV_FILE"
  exit 1
fi

cd "$INSTALL_DIR"
git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

echo "=== StreamRelay: الرجوع إلى $PREV_LABEL ($PREV_COMMIT) ==="
{
  echo "[$(date -Iseconds)] rollback start -> $PREV_COMMIT"
  git reset --hard "$PREV_COMMIT"
  COMMIT="$(git log -1 --oneline 2>/dev/null || echo unknown)"
  echo "النسخة بعد الرجوع: $COMMIT"
  chmod +x scripts/*.sh 2>/dev/null || true
  bash "${SCRIPT_DIR}/deploy-update.sh"
} >> "$LOG_FILE" 2>&1
RESULT=$?

if [ "$RESULT" -eq 0 ]; then
  cat > "$STATUS_FILE" <<EOF
{"state":"success","message":"تم الرجوع للنسخة السابقة بنجاح","commit":"$(git log -1 --oneline 2>/dev/null | sed 's/"/\\"/g')","at":"$(date -Iseconds)","rollback":true}
EOF
  echo "SUCCESS: rollback to $PREV_COMMIT"
else
  cat > "$STATUS_FILE" <<EOF
{"state":"failed","message":"فشل الرجوع — راجع .update.log","commit":"","at":"$(date -Iseconds)","rollback":true}
EOF
  echo "FAILED: rollback (exit=$RESULT) — see $LOG_FILE"
  exit 1
fi
