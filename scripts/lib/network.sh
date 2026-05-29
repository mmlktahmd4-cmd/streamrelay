#!/bin/bash
# StreamRelay — دوال شبكة آمنة (بدون awk — يتجنب أخطاء الاقتباس على Linux)

# مزامنة مجلد التثبيت مع GitHub — يتجاهل تعديلات محلية على السكربتات
sync_install_repo() {
  local dir="${1:-/opt/streamrelay}"
  local branch="${2:-main}"

  [ -d "$dir/.git" ] || return 0

  git config --global --add safe.directory "$dir" 2>/dev/null || true
  git -C "$dir" fetch origin "$branch" 2>/dev/null || {
    echo "تحذير: git fetch فشل في $dir"
    return 1
  }

  if ! git -C "$dir" rev-parse "origin/$branch" &>/dev/null; then
    echo "تحذير: origin/$branch غير موجود"
    return 1
  fi

  if [ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]; then
    echo "      تجاهل تعديلات محلية — مزامنة مع GitHub..."
    git -C "$dir" reset --hard "origin/$branch"
  elif ! git -C "$dir" merge --ff-only "origin/$branch" 2>/dev/null; then
    git -C "$dir" reset --hard "origin/$branch"
  fi
}

# أول IPv4 مناسب: يفضّل 192.168.x ثم يتجنب 127 و 172.16-31 (Docker/VPN)
detect_server_ip() {
  local ip="" candidate

  for candidate in $(hostname -I 2>/dev/null); do
    case "$candidate" in
      192.168.*) echo "$candidate"; return ;;
    esac
  done

  for candidate in $(hostname -I 2>/dev/null); do
    case "$candidate" in
      [0-9]*.[0-9]*.[0-9]*.[0-9]*)
        if [ "${candidate%%.*}" = "127" ]; then continue; fi
        if [[ "$candidate" =~ ^172\.(1[6-9]|2[0-9]|3[01])\. ]]; then continue; fi
        ip="$candidate"
        break
        ;;
    esac
  done

  if [ -z "$ip" ] && command -v ip &>/dev/null; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)"
  fi

  if [ -z "$ip" ]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
}

# 192.168.5.102 → 192.168.5.0/24 (bash فقط — لا awk)
ip_to_subnet() {
  local ip="${1:-}"
  local a b c _rest
  IFS=. read -r a b c _rest <<< "$ip"
  if [ -n "$a" ] && [ -n "$b" ] && [ -n "$c" ]; then
    echo "${a}.${b}.${c}.0/24"
  fi
}

# IP مثبّت: .env → .streamrelay-network → اكتشاف تلقائي
resolve_server_ip() {
  local install_dir="${1:-.}"
  local existing pinned

  if [ -f "${install_dir}/.env" ]; then
    existing="$(grep '^SERVER_IP=' "${install_dir}/.env" 2>/dev/null | cut -d= -f2- || true)"
    if [ -n "$existing" ] && [ "$existing" != "127.0.0.1" ]; then
      echo "$existing"
      return
    fi
  fi

  if [ -f "${install_dir}/.streamrelay-network" ]; then
    pinned="$(grep '^SERVER_IP=' "${install_dir}/.streamrelay-network" 2>/dev/null | cut -d= -f2- || true)"
    if [ -n "$pinned" ] && [ "$pinned" != "127.0.0.1" ]; then
      echo "$pinned"
      return
    fi
  fi

  detect_server_ip
}

# http://192.168.5.102:8080 — يوحّد المنفذ مع STREAMRELAY_HTTP_PORT
public_base_url() {
  local ip="$1"
  local port="${2:-80}"
  port="${port// /}"
  [ -n "$port" ] || port="80"
  if [ "$port" = "80" ]; then
    echo "http://${ip}"
  else
    echo "http://${ip}:${port}"
  fi
}

read_http_port() {
  local install_dir="${1:-.}"
  local port
  port="$(grep '^STREAMRELAY_HTTP_PORT=' "${install_dir}/.env" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]' || true)"
  [ -n "$port" ] || port="80"
  echo "$port"
}

allowed_origins_for() {
  local base_url="$1"
  echo "${base_url},http://localhost,http://127.0.0.1,http://localhost:5173,http://127.0.0.1:5173"
}

sync_env_public_urls() {
  local install_dir="$1"
  local ip="$2"
  local port="${3:-$(read_http_port "$install_dir")}"
  local base_url
  base_url="$(public_base_url "$ip" "$port")"

  set_env_key() {
    local key="$1"
    local val="$2"
    local env_file="${install_dir}/.env"
    if grep -q "^${key}=" "$env_file" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$env_file"
    else
      echo "${key}=${val}" >> "$env_file"
    fi
  }

  set_env_key STREAMRELAY_HTTP_PORT "$port"
  set_env_key SERVER_IP "$ip"
  set_env_key PUBLIC_BASE_URL "$base_url"
  set_env_key HLS_BASE_URL "${base_url}/api/hls"
  set_env_key RTMP_INGEST_URL "rtmp://${ip}:1935/live"
  set_env_key ALLOWED_ORIGINS "$(allowed_origins_for "$base_url")"
  echo "$base_url"
}
