#!/bin/bash
# StreamRelay — دوال شبكة آمنة (بدون awk — يتجنب أخطاء الاقتباس على Linux)

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
