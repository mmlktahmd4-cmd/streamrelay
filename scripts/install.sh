#!/bin/bash
# StreamRelay — Production deployment (Ubuntu 22/24)
# للتثبيت السريع: scripts/ubuntu-quick-install.sh أو scripts/install-ubuntu22.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/ubuntu-quick-install.sh" "$@"