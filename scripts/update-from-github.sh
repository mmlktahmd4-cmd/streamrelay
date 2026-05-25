#!/bin/bash
# تحديث StreamRelay من GitHub (بعد التثبيت الأول)
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
BRANCH="${GITHUB_BRANCH:-}"

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "المشروع غير مثبت عبر git في $INSTALL_DIR"
  exit 1
fi

cd "$INSTALL_DIR"
echo "=== git pull ==="
git fetch origin
if [ -n "$BRANCH" ]; then
  git checkout "$BRANCH"
fi
git pull origin "$(git branch --show-current)"

echo "=== إعادة بناء Docker ==="
docker compose build --parallel
docker compose up -d

echo "=== تم التحديث ==="
docker compose ps
