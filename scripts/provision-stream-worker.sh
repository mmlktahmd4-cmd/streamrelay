#!/bin/bash
# StreamRelay — ربط سيرفر بث بعيد (يُرفع عبر SSH ثم يُشغَّل بـ root أو sudo)
set -euo pipefail

MASTER_IP="${MASTER_IP:?MASTER_IP required}"
SERVER_ID="${SERVER_ID:?SERVER_ID required}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"

WORKER_IP="${WORKER_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
POSTGRES_USER="${POSTGRES_USER:-streamrelay}"
POSTGRES_DB="${POSTGRES_DB:-streamrelay}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"
REDIS_PORT="${REDIS_PORT:-6379}"
GITHUB_REPO="${GITHUB_REPO:-https://github.com/mmlktahmd4-cmd/streamrelay.git}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
STREAMRELAY_HTTP_PORT="${STREAMRELAY_HTTP_PORT:-8080}"

log() { echo "[provision] $*"; }
fail() { echo "[provision] ERROR: $*" >&2; exit 1; }

log "Master=$MASTER_IP | Worker=$SERVER_ID ($WORKER_IP) | HTTP=$STREAMRELAY_HTTP_PORT"

export DEBIAN_FRONTEND=noninteractive

if ! command -v git &>/dev/null || ! command -v curl &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates
fi

if ! command -v docker &>/dev/null; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

if ! docker compose version &>/dev/null 2>&1; then
  apt-get install -y -qq docker-compose-plugin 2>/dev/null || true
fi

command -v docker compose &>/dev/null || fail "docker compose غير متوفر"

# فحص اتصال السيرفر الرئيسي قبل البناء
if command -v nc &>/dev/null; then
  nc -z -w5 "$MASTER_IP" "$POSTGRES_PORT" || fail "لا يوجد اتصال بـ Postgres على ${MASTER_IP}:${POSTGRES_PORT} — فعّل POSTGRES_PUBLISH=0.0.0.0:5432 على الرئيسي"
  nc -z -w5 "$MASTER_IP" "$REDIS_PORT" || fail "لا يوجد اتصال بـ Redis على ${MASTER_IP}:${REDIS_PORT} — فعّل REDIS_PUBLISH=0.0.0.0:6379 على الرئيسي"
else
  apt-get install -y -qq netcat-openbsd 2>/dev/null || true
  if command -v nc &>/dev/null; then
    nc -z -w5 "$MASTER_IP" "$POSTGRES_PORT" || fail "Postgres غير reachable على ${MASTER_IP}:${POSTGRES_PORT}"
    nc -z -w5 "$MASTER_IP" "$REDIS_PORT" || fail "Redis غير reachable على ${MASTER_IP}:${REDIS_PORT}"
  fi
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating $INSTALL_DIR from GitHub..."
  git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
  git -C "$INSTALL_DIR" fetch origin "$GITHUB_BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$GITHUB_BRANCH"
else
  log "Cloning from GitHub..."
  rm -rf "$INSTALL_DIR"
  git clone --branch "$GITHUB_BRANCH" --depth 1 "$GITHUB_REPO" "$INSTALL_DIR" 2>/dev/null \
    || git clone --depth 1 "$GITHUB_REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
[ -f docker-compose.worker-remote.yml ] || fail "docker-compose.worker-remote.yml غير موجود — اسحب آخر نسخة من GitHub"
chmod +x scripts/*.sh 2>/dev/null || true

log "Writing .env for remote worker"
cat > .env <<EOF
NODE_ENV=production
API_PORT=3000
SERVER_ID=${SERVER_ID}
SERVER_ROLE=stream-only
SERVER_IP=${WORKER_IP}
STREAMRELAY_HTTP_PORT=${STREAMRELAY_HTTP_PORT}
PUBLIC_BASE_URL=http://${WORKER_IP}:${STREAMRELAY_HTTP_PORT}
HLS_BASE_URL=http://${WORKER_IP}:${STREAMRELAY_HTTP_PORT}/api/hls

POSTGRES_HOST=${MASTER_IP}
POSTGRES_PORT=${POSTGRES_PORT}
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

REDIS_HOST=${MASTER_IP}
REDIS_PORT=${REDIS_PORT}
REDIS_PASSWORD=${REDIS_PASSWORD}

HLS_OUTPUT_DIR=/var/www/hls
MPEGTS_OUTPUT_DIR=/var/www/mpegts
VOD_DIR=/var/www/vod
MAX_CONCURRENT_STREAMS=200
HEALTH_CHECK_INTERVAL=15
LOG_DIR=/var/log/streamrelay
JWT_SECRET=remote-worker-placeholder
JWT_REFRESH_SECRET=remote-worker-placeholder
EOF

log "Building remote worker stack..."
if ! docker compose -f docker-compose.worker-remote.yml build worker nginx-hls; then
  fail "فشل docker build — راجع: docker compose -f docker-compose.worker-remote.yml build"
fi

log "Starting containers..."
if ! docker compose -f docker-compose.worker-remote.yml up -d; then
  docker compose -f docker-compose.worker-remote.yml logs --tail 40 2>/dev/null || true
  fail "فشل docker compose up"
fi

sleep 6
docker compose -f docker-compose.worker-remote.yml ps

if ! docker compose -f docker-compose.worker-remote.yml ps --status running 2>/dev/null | grep -q worker; then
  docker compose -f docker-compose.worker-remote.yml logs worker --tail 50 2>/dev/null || true
  fail "حاوية worker لم تبدأ — تحقق من اتصال Postgres/Redis"
fi

log "SUCCESS: Remote worker $SERVER_ID @ $WORKER_IP"
