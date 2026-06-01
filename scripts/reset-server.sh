#!/bin/bash
# ─────────────────────────────────────────────────────────────
# StreamRelay — حذف كامل + تثبيت جديد من GitHub
#
# أمر واحد:
#   cd / && curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/reset-server.sh | sudo bash
# ─────────────────────────────────────────────────────────────
set -euo pipefail

cd / 2>/dev/null || cd /tmp 2>/dev/null || true

RAW_BASE="${STREAMRELAY_RAW:-https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main}"

if [ "$EUID" -ne 0 ]; then
  echo "شغّل: cd / && curl ... | sudo bash"
  exit 1
fi

TMP="$(mktemp /tmp/streamrelay-wipe.XXXXXX.sh)"
curl -fsSL "${RAW_BASE}/scripts/wipe-server.sh" -o "$TMP"
chmod +x "$TMP"
bash "$TMP"
rm -f "$TMP"

echo ""
echo "=============================================="
echo "  بدء التثبيت الجديد..."
echo "=============================================="

TMP2="$(mktemp /tmp/streamrelay-install.XXXXXX.sh)"
curl -fsSL "${RAW_BASE}/scripts/install-from-github.sh" -o "$TMP2"
chmod +x "$TMP2"
exec bash "$TMP2"
