#!/bin/bash
# فحص ما قبل التثبيت — Ubuntu 22/24
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/network.sh
source "$SCRIPT_DIR/lib/network.sh"

echo "=== StreamRelay — فحص ما قبل التثبيت ==="
echo ""

if [ -f /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "النظام: ${PRETTY_NAME:-unknown}"
else
  echo "النظام: unknown"
fi

echo "IP السيرفر: $(detect_server_ip)"
echo "شبكة MikroTik (اقتراح): $(ip_to_subnet "$(detect_server_ip)")"
echo ""

checks_ok=0
checks_fail=0

check() {
  local name="$1"
  local ok="$2"
  if [ "$ok" = "1" ]; then
    echo "  [OK]   $name"
    checks_ok=$((checks_ok + 1))
  else
    echo "  [FAIL] $name"
    checks_fail=$((checks_fail + 1))
  fi
}

if [ -f "$ROOT/scripts/lib/network.sh" ] && declare -F ip_to_subnet >/dev/null 2>&1; then
  echo "  [OK]   ip_to_subnet (bash) جاهز — بدون awk"
  checks_ok=$((checks_ok + 1))
else
  echo "  [FAIL] scripts/lib/network.sh ناقص — احذف /opt/streamrelay وأعد clone"
  checks_fail=$((checks_fail + 1))
fi

if [ -f "$ROOT/scripts/lib/network.sh" ]; then
  echo "  [OK]   scripts/lib/network.sh موجود"
  checks_ok=$((checks_ok + 1))
else
  echo "  [FAIL] scripts/lib/network.sh مفقود — git pull"
  checks_fail=$((checks_fail + 1))
fi

if [ "$EUID" -eq 0 ] || command -v sudo &>/dev/null; then
  check "root أو sudo" "1"
else
  check "root أو sudo" "0"
fi
check "curl" "$(command -v curl &>/dev/null && echo 1 || echo 0)"
check "git" "$(command -v git &>/dev/null && echo 1 || echo 0)"
check "python3" "$(command -v python3 &>/dev/null && echo 1 || echo 0)"

if command -v docker &>/dev/null; then
  echo "  [OK]   docker"
  checks_ok=$((checks_ok + 1))
else
  echo "  [SKIP] docker — سيُثبَّت مع ubuntu-quick-install.sh"
fi

if [ -f "$ROOT/docker-compose.yml" ]; then
  if ! command -v docker &>/dev/null; then
    echo "  [SKIP] docker-compose.yml — Docker غير مثبت بعد"
  elif (cd "$ROOT" && docker compose config -q &>/dev/null); then
    check "docker-compose.yml" "1"
  else
    check "docker-compose.yml" "0"
  fi
else
  echo "  [SKIP] docker-compose.yml — شغّل من مجلد المشروع"
fi

echo ""
if [ "$checks_fail" -gt 0 ]; then
  echo "بعض الفحوصات فشلت — راجع docs/INSTALL-TROUBLESHOOTING.md"
  exit 1
fi

echo "جاهز للتثبيت:"
echo "  sudo bash scripts/ubuntu-quick-install.sh"
echo ""
