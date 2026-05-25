#!/bin/bash
# ─────────────────────────────────────────────────────────────
# StreamRelay — clone من GitHub + تثبيت (مثل easy-install)
#
# الاستخدام:
#   curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/clone-install.sh | sudo bash
#
# أو بعد clone:
#   sudo bash scripts/clone-install.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

REPO_URL="${GITHUB_REPO:-https://github.com/mmlktahmd4-cmd/streamrelay.git}"
RAW_BASE="${STREAMRELAY_RAW:-https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main}"

if [ "$EUID" -ne 0 ]; then
  echo "شغّل كـ root: curl ... | sudo bash"
  exit 1
fi

if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  exec bash "${SCRIPT_DIR}/install-from-github.sh" "$REPO_URL"
fi

cd /tmp
TMP="$(mktemp /tmp/streamrelay-clone-install.XXXXXX.sh)"
curl -fsSL "${RAW_BASE}/scripts/install-from-github.sh" -o "$TMP"
chmod +x "$TMP"
exec bash "$TMP" "$REPO_URL"
