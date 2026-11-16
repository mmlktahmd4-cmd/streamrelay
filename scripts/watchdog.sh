#!/bin/bash
# StreamRelay Watchdog — monitors and restarts failed services
# Run via cron: */1 * * * * /opt/streamrelay/scripts/watchdog.sh

set -euo pipefail

API_URL="${API_URL:-http://localhost:3000/api/health}"
LOG_FILE="${LOG_FILE:-/var/log/streamrelay/watchdog.log}"
MAX_RETRIES=3

log() {
  echo "[$(date -Iseconds)] $1" >> "$LOG_FILE"
}

check_api() {
  local status
  status=$(curl -sf -o /dev/null -w "%{http_code}" "$API_URL" 2>/dev/null || echo "000")
  [ "$status" = "200" ]
}

check_nginx() {
  curl -sf -o /dev/null "http://localhost/nginx-health" 2>/dev/null
}

check_postgres() {
  docker exec sr-postgres pg_isready -U streamrelay >/dev/null 2>&1
}

check_redis() {
  docker exec sr-redis redis-cli ping 2>/dev/null | grep -q PONG
}

restart_service() {
  local service="$1"
  log "RESTART: $service"
  docker compose -f /opt/streamrelay/docker-compose.yml restart "$service" 2>>"$LOG_FILE"
}

# ─── Checks ──────────────────────────────────────────────────
mkdir -p "$(dirname "$LOG_FILE")"

if ! check_api; then
  log "WARN: API health check failed"
  restart_service api
fi

if ! check_nginx; then
  log "WARN: Nginx health check failed"
  restart_service nginx
fi

if ! check_postgres; then
  log "WARN: PostgreSQL health check failed"
  restart_service postgres
fi

if ! check_redis; then
  log "WARN: Redis health check failed"
  restart_service redis
fi

log "OK: All services healthy"
