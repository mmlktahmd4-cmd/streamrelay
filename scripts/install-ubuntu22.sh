#!/bin/bash
# StreamRelay — تثبيت على Ubuntu 22.04 (اختصار)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/ubuntu-quick-install.sh" "$@"