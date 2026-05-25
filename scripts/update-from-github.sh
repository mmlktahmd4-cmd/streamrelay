#!/bin/bash
# تحديث StreamRelay من GitHub (Ubuntu 22 / 24)
# الاستخدام: cd /opt/streamrelay && sudo bash scripts/update-from-github.sh
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
BRANCH="${GITHUB_BRANCH:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$EUID" -ne 0 ]; then
  echo "شغّل كـ root: sudo bash scripts/update-from-github.sh"
  exit 1
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo "المشروع غير مثبت عبر git في $INSTALL_DIR"
  echo "استخدم: sudo bash scripts/easy-install.sh"
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

echo "=== بناء ونشر التحديث ==="
bash "${SCRIPT_DIR}/deploy-update.sh"

echo "=== تم التحديث ==="
docker compose ps
