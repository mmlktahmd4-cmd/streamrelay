#!/bin/bash
# ─────────────────────────────────────────────────────────────
# StreamRelay — ربط سيرفر بث بعيد تلقائياً (يُنفَّذ عبر SSH من السيرفر الرئيسي)
# المتغيرات المطلوبة: MASTER_IP, SERVER_ID, POSTGRES_PASSWORD
# ─────────────────────────────────────────────────────────────
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

if [ "$EUID" -ne 0 ]; then
  echo "يجب تشغيل السكربت كـ root"
  exit 1
fi

log "Master=$MASTER_IP | Worker=$SERVER_ID ($WORKER_IP) | Port=$STREAMRELAY_HTTP_PORT"

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

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing install at $INSTALL_DIR"
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
chmod +x scripts/*.sh 2>/dev/null || true

log "Writing remote worker .env"
cat > .env <<EOF
NODE_ENV=production
API_PORT=3000
SERVER_ID=${SERVER_ID}
SERVER_ROLE=stream-only
SERVER_IP=${WORKER_IP}
STREAMRELAY_HTTP_PORT=${STREAMRELAY_HTTP_PORT}
PUBLIC_BASE_URL=http://${WORKER_IP}:${STREAMRELAY_HTTP_PORT}
HLS_BASE_URL=http://${WORKER_IP}:${STREAMRELAY_HTTP_PORT}/hls

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
EOF

log "Building and starting remote worker stack..."
docker compose -f docker-compose.worker-remote.yml build --quiet
docker compose -f docker-compose.worker-remote.yml up -d

log "Waiting for worker container..."
sleep 5
docker compose -f docker-compose.worker-remote.yml ps

log "Remote worker provision complete: $SERVER_ID @ $WORKER_IP"
