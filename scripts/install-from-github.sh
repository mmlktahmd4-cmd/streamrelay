#!/bin/bash
# ─────────────────────────────────────────────────────────────
# StreamRelay — تثبيت من GitHub على Ubuntu 22 / 24
#
# الاستخدام:
#   sudo bash scripts/install-from-github.sh https://github.com/USER/streamrelay.git
#
# أو بمتغير:
#   export GITHUB_REPO=https://github.com/USER/streamrelay.git
#   sudo -E bash scripts/install-from-github.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${1:-${GITHUB_REPO:-https://github.com/mmlktahmd4-cmd/streamrelay.git}}"
BRANCH="${GITHUB_BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"

if [ -z "$REPO_URL" ]; then
  echo "الاستخدام:"
  echo "  sudo bash scripts/install-from-github.sh https://github.com/USER/streamrelay.git"
  exit 1
fi

if [ "$EUID" -ne 0 ]; then
  echo "شغّل كـ root: sudo bash scripts/install-from-github.sh REPO_URL"
  exit 1
fi

echo "=============================================="
echo "  StreamRelay — تثبيت من GitHub"
echo "  $REPO_URL"
echo "=============================================="

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates

# استنساخ أو تحديث
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "المجلد موجود — git pull..."
  cd "$INSTALL_DIR"
  git fetch origin
  git checkout "$BRANCH" 2>/dev/null || git checkout main || git checkout master
  git pull origin "$(git branch --show-current)"
else
  echo "استنساخ إلى $INSTALL_DIR ..."
  rm -rf "$INSTALL_DIR"
  git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR" 2>/dev/null \
    || git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
chmod +x scripts/*.sh 2>/dev/null || true

if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  chown -R "$SUDO_USER:$SUDO_USER" "$INSTALL_DIR"
fi
git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

exec bash scripts/ubuntu-quick-install.sh
