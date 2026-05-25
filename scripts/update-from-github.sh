#!/bin/bash
# تحديث StreamRelay من GitHub (Ubuntu 22 / 24)
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
BRANCH="${GITHUB_BRANCH:-}"

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "المشروع غير مثبت عبر git في $INSTALL_DIR"
  exit 1
fi

cd "$INSTALL_DIR"
chmod +x scripts/*.sh 2>/dev/null || true

echo "=== git pull ==="
git fetch origin
if [ -n "$BRANCH" ]; then
  git checkout "$BRANCH"
fi
git pull origin "$(git branch --show-current)"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
export STREAMRELAY_HTTP_PORT="${STREAMRELAY_HTTP_PORT:-80}"

echo "=== إعادة بناء Docker (HTTP port: ${STREAMRELAY_HTTP_PORT}) ==="
docker compose build --parallel
docker compose up -d --force-recreate

echo "=== انتظار API ==="
for i in $(seq 1 30); do
  if docker compose exec -T api wget -qO- "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "=== تم التحديث ==="
docker compose ps
echo ""
echo "العنوان: ${PUBLIC_BASE_URL:-http://$(hostname -I | awk '{print $1}')}"
