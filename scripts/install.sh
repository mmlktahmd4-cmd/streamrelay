#!/bin/bash
# StreamRelay — Production deployment (Ubuntu/Debian)
# للتثبيت السريع على Ubuntu 24 استخدم: scripts/ubuntu-quick-install.sh
set -euo pipefail
exec "$(dirname "$0")/ubuntu-quick-install.sh" "$@"
