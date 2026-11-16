#!/bin/bash
# الرجوع لآخر نسخة قبل التحديث على سيرفر بث بعيد
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
PREV_FILE="${INSTALL_DIR}/.update-previous-commit"

log() { echo "[remote-rollback] $*"; }
fail() { echo "[remote-rollback] ERROR: $*" >&2; exit 1; }

command -v git &>/dev/null || fail "git غير مثبت"
command -v docker &>/dev/null || fail "docker غير مثبت"
docker compose version &>/dev/null 2>&1 || fail "docker compose غير متوفر"

[ -d "$INSTALL_DIR/.git" ] || fail "المشروع غير موجود في $INSTALL_DIR"

cd "$INSTALL_DIR"
[ -f docker-compose.worker-remote.yml ] || fail "docker-compose.worker-remote.yml غير موجود"

PREV_COMMIT=""
if [ -f "$PREV_FILE" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PREV_COMMIT="$(python3 -c "import json; d=json.load(open('$PREV_FILE')); print(d.get('commit',''))" 2>/dev/null || true)"
  fi
  [ -z "$PREV_COMMIT" ] && PREV_COMMIT="$(grep -o '"commit"[[:space:]]*:[[:space:]]*"[^"]*"' "$PREV_FILE" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
fi
if [ -z "$PREV_COMMIT" ]; then
  PREV_COMMIT="$(git rev-parse ORIG_HEAD 2>/dev/null || git rev-parse 'HEAD@{1}' 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || echo "")"
fi
[ -n "$PREV_COMMIT" ] || fail "لا توجد نسخة سابقة — نفّذ تحديثاً من اللوحة أولاً"

log "Rolling back to $PREV_COMMIT ..."
git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
git reset --hard "$PREV_COMMIT"

COMMIT="$(git -C "$INSTALL_DIR" log -1 --oneline 2>/dev/null || echo unknown)"
log "Git commit after rollback: $COMMIT"

log "Building worker + nginx-hls..."
docker compose -f docker-compose.worker-remote.yml build worker nginx-hls

log "Restarting containers..."
docker compose -f docker-compose.worker-remote.yml up -d --force-recreate worker nginx-hls

sleep 4
docker compose -f docker-compose.worker-remote.yml ps

if ! docker compose -f docker-compose.worker-remote.yml ps --status running 2>/dev/null | grep -q worker; then
  docker compose -f docker-compose.worker-remote.yml logs worker --tail 40 2>/dev/null || true
  fail "حاوية worker لم تبدأ بعد الرجوع"
fi

log "SUCCESS: Remote worker rolled back commit=$COMMIT"
