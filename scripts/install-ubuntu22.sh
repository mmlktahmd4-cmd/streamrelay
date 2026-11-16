#!/bin/bash
# StreamRelay — تثبيت على Ubuntu 22.04 (اختصار)
# الاستخدام:  sudo bash scripts/install-ubuntu22.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chmod +x "${SCRIPT_DIR}"/*.sh 2>/dev/null || true
exec bash "${SCRIPT_DIR}/ubuntu-quick-install.sh" "$@"