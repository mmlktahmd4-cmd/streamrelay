#!/bin/bash
# دوال مشتركة لسكربتات التثبيت والنشر — لا تشغّل مباشرة
set -euo pipefail

install_common_dir() {
  cd "${INSTALL_DIR:-/opt/streamrelay}"
}

ensure_node() {
  # systemd لا يضبط HOME عند تشغيل الخدمة — نضع قيمة افتراضية لتفادي "unbound variable"
  : "${HOME:=/root}"
  export HOME
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
  # vite وأدوات البناء في devDependencies — يجب تثبيتها حتى لو كان NODE_ENV=production في البيئة
  NODE_ENV=development npm install --include=dev --no-audit --no-fund --prefer-offline
  if [ ! -x node_modules/.bin/vite ]; then
    echo "      vite غير موجود — تثبيت نظيف..."
    rm -rf node_modules package-lock.json 2>/dev/null || true
    NODE_ENV=development npm install --include=dev --no-audit --no-fund
  fi
  NODE_ENV=production npm run build
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

stop_host_db_redis_conflicts() {
  systemctl stop redis-server redis postgresql 2>/dev/null || true
}

redis_ping_ok() {
  install_common_dir
  local rp
  rp="$(grep '^REDIS_PASSWORD=' .env 2>/dev/null | cut -d= -f2- || true)"
  if [ -n "$rp" ]; then
    docker compose exec -T redis redis-cli -a "$rp" ping --no-auth-warning 2>/dev/null | grep -q PONG
  else
    docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG
  fi
}

wait_for_redis() {
  local attempts="${1:-40}"
  local delay="${2:-2}"
  install_common_dir
  for _ in $(seq 1 "$attempts"); do
    if redis_ping_ok; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

reset_redis_volume() {
  install_common_dir
  docker compose stop redis 2>/dev/null || true
  docker compose rm -f redis 2>/dev/null || true
  local vol
  vol="$(docker volume ls -q | grep -E 'redis_data$' | head -1 || true)"
  if [ -n "$vol" ]; then
    docker volume rm "$vol" 2>/dev/null || true
  fi
}

# وحدة systemd تراقب .network-request وتطبّقها على الجهاز (root) — تسمح بتغيير IP من اللوحة
install_network_apply_unit() {
  local dir="${INSTALL_DIR:-/opt/streamrelay}"
  command -v systemctl >/dev/null 2>&1 || return 0
  [ -w /etc/systemd/system ] || return 0

  cat > /etc/systemd/system/streamrelay-network.service <<UNIT
[Unit]
Description=StreamRelay apply network request from admin panel
After=network.target

[Service]
Type=oneshot
WorkingDirectory=${dir}
ExecStart=/bin/bash ${dir}/scripts/apply-network-request.sh
UNIT

  cat > /etc/systemd/system/streamrelay-network.path <<UNIT
[Unit]
Description=StreamRelay watch .network-request file

[Path]
PathExists=${dir}/.network-request
Unit=streamrelay-network.service

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload 2>/dev/null || true
  systemctl enable --now streamrelay-network.path 2>/dev/null || true
}

# وحدة systemd تراقب .update-request وتطبّق تحديث اللوحة (git pull + deploy-update) كـ root — تسمح بالتحديث من اللوحة بضغطة
install_update_apply_unit() {
  local dir="${INSTALL_DIR:-/opt/streamrelay}"
  command -v systemctl >/dev/null 2>&1 || return 0
  [ -w /etc/systemd/system ] || return 0

  cat > /etc/systemd/system/streamrelay-update.service <<UNIT
[Unit]
Description=StreamRelay apply panel update request from admin panel
After=network.target docker.service

[Service]
Type=oneshot
Environment=HOME=/root
WorkingDirectory=${dir}
ExecStart=/bin/bash ${dir}/scripts/apply-update-request.sh
TimeoutStartSec=1800
UNIT

  cat > /etc/systemd/system/streamrelay-update.path <<UNIT
[Unit]
Description=StreamRelay watch .update-request file

[Path]
PathExists=${dir}/.update-request
Unit=streamrelay-update.service

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload 2>/dev/null || true
  systemctl enable --now streamrelay-update.path 2>/dev/null || true

  cat > /etc/systemd/system/streamrelay-rollback.service <<UNIT
[Unit]
Description=StreamRelay rollback panel to previous commit
After=network.target docker.service

[Service]
Type=oneshot
Environment=HOME=/root
WorkingDirectory=${dir}
ExecStart=/bin/bash ${dir}/scripts/apply-rollback-request.sh
TimeoutStartSec=1800
UNIT

  cat > /etc/systemd/system/streamrelay-rollback.path <<UNIT
[Unit]
Description=StreamRelay watch .update-rollback-request file

[Path]
PathExists=${dir}/.update-rollback-request
Unit=streamrelay-rollback.service

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload 2>/dev/null || true
  systemctl enable --now streamrelay-rollback.path 2>/dev/null || true
}

print_streamrelay_urls() {
  install_common_dir
  local script_dir server_ip http_port base_url
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=lib/network.sh
  source "${script_dir}/lib/network.sh" 2>/dev/null || true
  # IP الفعلي على كرت الشبكة — لا نعتمد على SERVER_IP قديم في .env
  if declare -F resolve_server_ip >/dev/null 2>&1; then
    server_ip="$(resolve_server_ip . 2>/dev/null)"
  else
    server_ip="$(grep '^SERVER_IP=' .env 2>/dev/null | cut -d= -f2-)"
  fi
  [ -n "$server_ip" ] || server_ip="$(detect_server_ip 2>/dev/null || echo 127.0.0.1)"
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
