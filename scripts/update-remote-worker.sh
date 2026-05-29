#!/bin/bash
# تحديث سيرفر بث بعيد — مزامنة GitHub + إعادة بناء worker (يُشغَّل عبر SSH من الرئيسي أو لوحة الإدارة)
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
GITHUB_REPO="${GITHUB_REPO:-https://github.com/mmlktahmd4-cmd/streamrelay.git}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"

log() { echo "[remote-update] $*"; }
fail() { echo "[remote-update] ERROR: $*" >&2; exit 1; }

command -v git &>/dev/null || fail "git غير مثبت"
command -v docker &>/dev/null || fail "docker غير مثبت"
docker compose version &>/dev/null 2>&1 || fail "docker compose غير متوفر"

if [ ! -d "$INSTALL_DIR/.git" ]; then
  fail "المشروع غير موجود في $INSTALL_DIR — استخدم الربط التلقائي (SSH) أولاً"
fi

cd "$INSTALL_DIR"
[ -f docker-compose.worker-remote.yml ] || fail "docker-compose.worker-remote.yml غير موجود"
chmod +x scripts/*.sh 2>/dev/null || true

# shellcheck source=lib/network.sh
source "$INSTALL_DIR/scripts/lib/network.sh" 2>/dev/null || true

log "Syncing with GitHub ($GITHUB_BRANCH)..."
if declare -F sync_install_repo >/dev/null 2>&1; then
  sync_install_repo "$INSTALL_DIR" "$GITHUB_BRANCH"
else
  git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
  git fetch origin "$GITHUB_BRANCH"
  git reset --hard "origin/$GITHUB_BRANCH"
fi

COMMIT="$(git -C "$INSTALL_DIR" log -1 --oneline 2>/dev/null || echo unknown)"
log "Git commit: $COMMIT"

log "Building worker + nginx-hls..."
docker compose -f docker-compose.worker-remote.yml build worker nginx-hls

log "Restarting containers..."
docker compose -f docker-compose.worker-remote.yml up -d --force-recreate worker nginx-hls

sleep 4
docker compose -f docker-compose.worker-remote.yml ps

if ! docker compose -f docker-compose.worker-remote.yml ps --status running 2>/dev/null | grep -q worker; then
  docker compose -f docker-compose.worker-remote.yml logs worker --tail 40 2>/dev/null || true
  fail "حاوية worker لم تبدأ بعد التحديث"
fi

log "SUCCESS: Remote worker updated @ $(hostname -I 2>/dev/null | awk '{print $1}') commit=$COMMIT"
