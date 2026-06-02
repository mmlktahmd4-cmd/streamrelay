#!/bin/bash
# يطبّق طلب «تحديث اللوحة» الذي تكتبه لوحة الإدارة (.update-request) على الجهاز
# يُستدعى من systemd path unit (streamrelay-update.path) أو يدوياً:
#   sudo bash scripts/apply-update-request.sh
set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUEST_FILE="${INSTALL_DIR}/.update-request"
STATUS_FILE="${INSTALL_DIR}/.update-status"
LOG_FILE="${INSTALL_DIR}/.update.log"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"

[ -f "$REQUEST_FILE" ] || exit 0

if [ "$EUID" -ne 0 ]; then
  echo "خطأ: يجب التشغيل كـ root" >&2
  exit 1
fi

# اقرأ الفرع من الطلب إن وُجد
while IFS='=' read -r key val; do
  case "$key" in
    BRANCH) [ -n "$val" ] && GITHUB_BRANCH="$val" ;;
  esac
done < "$REQUEST_FILE"

# احذف الطلب فوراً لتفادي إعادة التشغيل المتكرر من path unit
rm -f "$REQUEST_FILE" 2>/dev/null || true

write_status() {
  # state, message, commit
  local state="$1" msg="$2" commit="${3:-}"
  cat > "$STATUS_FILE" <<EOF
{"state":"${state}","message":"${msg}","commit":"${commit}","at":"$(date -Iseconds)"}
EOF
  chmod 600 "$STATUS_FILE" 2>/dev/null || true
}

write_status running "جاري تنزيل التحديث من GitHub وتطبيقه..." ""

cd "$INSTALL_DIR" || { write_status failed "مجلد التثبيت غير موجود" ""; exit 1; }

PREV_FILE="${INSTALL_DIR}/.update-previous-commit"
PREV_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo "")"
PREV_LABEL="$(git log -1 --oneline 2>/dev/null || echo "")"
if [ -n "$PREV_COMMIT" ]; then
  printf '{"commit":"%s","saved_at":"%s","label":"%s"}\n' \
    "$PREV_COMMIT" "$(date -Iseconds)" "$PREV_LABEL" > "$PREV_FILE"
  chmod 600 "$PREV_FILE" 2>/dev/null || true
  echo "حُفظ commit السابق للرجوع: $PREV_LABEL" >> "$LOG_FILE"
fi

COMMIT=""
{
  echo "════════════════════════════════════════"
  echo "[$(date -Iseconds)] بدء تحديث اللوحة (الفرع: ${GITHUB_BRANCH})"
  git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
  echo "── git fetch ──"
  git fetch origin "$GITHUB_BRANCH"
  echo "── git reset --hard origin/${GITHUB_BRANCH} ──"
  git reset --hard "origin/${GITHUB_BRANCH}"
  COMMIT="$(git log -1 --oneline 2>/dev/null || echo unknown)"
  echo "النسخة الجديدة: $COMMIT"
  chmod +x scripts/*.sh 2>/dev/null || true
  echo "── deploy-update.sh ──"
  bash "${SCRIPT_DIR}/deploy-update.sh"
} >> "$LOG_FILE" 2>&1
RESULT=$?

if [ "$RESULT" -eq 0 ]; then
  write_status success "تم تحديث اللوحة بنجاح ✓" "$COMMIT"
  echo "[$(date -Iseconds)] نجح التحديث: $COMMIT" >> "$LOG_FILE"
else
  LAST_ERR=""
  if [ -f "$LOG_FILE" ]; then
    LAST_ERR="$(tail -n 8 "$LOG_FILE" | tr '\n' ' ' | sed 's/"/\\"/g' | cut -c1-400)"
  fi
  MSG="فشل التحديث — راجع .update.log على السيرفر"
  [ -n "$LAST_ERR" ] && MSG="${MSG} — ${LAST_ERR}"
  write_status failed "$MSG" "$COMMIT"
  echo "[$(date -Iseconds)] فشل التحديث (exit=$RESULT)" >> "$LOG_FILE"
fi
