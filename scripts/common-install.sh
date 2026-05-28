#!/bin/bash
# دوال مشتركة لسكربتات التثبيت والنشر — لا تشغّل مباشرة
set -euo pipefail

install_common_dir() {
  cd "${INSTALL_DIR:-/opt/streamrelay}"
}

ensure_node() {
  export PATH="${HOME}/.local/node/bin:/usr/local/bin:/usr/bin:$PATH"
  if command -v node >/dev/null 2>&1; then
    return 0
  fi
  echo "      تثبيت Node.js محلياً للبناء..."
  mkdir -p "${HOME}/.local/node"
  curl -fsSL https://nodejs.org/dist/v20.20.2/node-v20.20.2-linux-x64.tar.xz \
    | tar -xJ -C "${HOME}/.local/node" --strip-components=1
  export PATH="${HOME}/.local/node/bin:$PATH"
}

build_frontend() {
  install_common_dir
  ensure_node
  echo "      npm install + build (frontend)..."
  cd frontend
  npm install --prefer-offline
  npm run build
  cd ..
}

wait_for_api() {
  local attempts="${1:-60}"
  local delay="${2:-3}"
  install_common_dir
  for i in $(seq 1 "$attempts"); do
    if docker compose exec -T api wget -qO- "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

print_streamrelay_urls() {
  install_common_dir
  local script_dir server_ip http_port base_url
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=lib/network.sh
  source "${script_dir}/lib/network.sh" 2>/dev/null || true
  server_ip="$(grep '^SERVER_IP=' .env 2>/dev/null | cut -d= -f2- || detect_server_ip)"
  http_port="$(read_http_port . 2>/dev/null || echo 80)"
  base_url="$(public_base_url "$server_ip" "$http_port" 2>/dev/null || echo "http://${server_ip}:${http_port}")"

  echo ""
  echo "=============================================="
  echo "  StreamRelay — جاهز"
  echo "=============================================="
  echo "  الإدارة:   ${base_url}/login"
  echo "  المشاهدة:  ${base_url}/watch/login"
  echo "  API:       ${base_url}/api/health"
  echo ""
  echo "  لا تستخدم :8888 أو /api/panel"
  echo "=============================================="
}
