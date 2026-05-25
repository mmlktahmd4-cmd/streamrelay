#!/bin/bash
# StreamRelay — Production deployment (Ubuntu 22/24)
# للتثبيت السريع: scripts/ubuntu-quick-install.sh أو scripts/install-ubuntu22.sh
set -euo pipefail
exec "$(dirname "$0")/ubuntu-quick-install.sh" "$@"
