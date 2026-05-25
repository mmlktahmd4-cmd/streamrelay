#!/bin/bash
# ─────────────────────────────────────────────────────────────
# StreamRelay — التثبيت السهل (Ubuntu 22 / 24)
#
# أمر واحد من الإنترنت:
#   curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/easy-install.sh | sudo bash
#
# أو من المستودع المحلي:
#   sudo bash scripts/easy-install.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${GITHUB_REPO:-https://github.com/mmlktahmd4-cmd/streamrelay.git}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$EUID" -ne 0 ]; then
  echo "شغّل كـ root: sudo bash scripts/easy-install.sh"
  exit 1
fi

exec bash "${SCRIPT_DIR}/install-from-github.sh" "$REPO_URL"
