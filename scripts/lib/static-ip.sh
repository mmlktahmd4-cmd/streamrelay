#!/bin/bash
# StreamRelay — تثبيت IP ثابت على Ubuntu (netplan / NetworkManager)

is_cloud_or_virtual_skip_static() {
  if [ -f /run/cloud-init/instance-data.json ] || [ -d /var/lib/cloud/instances ]; then
    if command -v cloud-init &>/dev/null; then
      local platform
      platform="$(cloud-init query platform 2>/dev/null || true)"
      case "$platform" in
        ec2|gce|azure|digitalocean|openstack|nocloud) return 0 ;;
      esac
    fi
  fi

  local product
  product="$(tr -d '\0' </sys/class/dmi/id/product_name 2>/dev/null || true)"
  case "$product" in
    *Amazon*|*Google*|*OpenStack*|*VirtualBox*|*VMware*|*KVM*|*QEMU*) return 0 ;;
  esac
  return 1
}

detect_default_route_iface() {
  ip -4 route show default 2>/dev/null | awk '{print $5; exit}'
}

detect_iface_ipv4_cidr() {
  local iface="$1"
  ip -4 -o addr show dev "$iface" scope global 2>/dev/null | awk '{print $4; exit}'
}

detect_default_gateway() {
  ip -4 route show default 2>/dev/null | awk '{print $3; exit}'
}

detect_dns_servers() {
  if command -v resolvectl &>/dev/null; then
    resolvectl dns 2>/dev/null | awk '{for (i = 2; i <= NF; i++) if ($i ~ /^[0-9]/) print $i}'
    return
  fi
  if [ -f /run/systemd/resolve/resolv.conf ]; then
    grep -E '^nameserver ' /run/systemd/resolve/resolv.conf | awk '{print $2}'
    return
  fi
  grep -E '^nameserver ' /etc/resolv.conf 2>/dev/null | awk '{print $2}' | grep -v '^127\.'
}

is_static_ip_already() {
  local iface="$1"
  local yaml

  for yaml in /etc/netplan/*.yaml /etc/netplan/*.yml; do
    [ -f "$yaml" ] || continue
    if grep -q "dhcp4:[[:space:]]*false" "$yaml" 2>/dev/null \
      && grep -q "${iface}:" "$yaml" 2>/dev/null; then
      return 0
    fi
  done

  if command -v nmcli &>/dev/null; then
    local conn method
    conn="$(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep ":${iface}$" | cut -d: -f1 | head -1)"
    [ -z "$conn" ] && conn="$(nmcli -t -f NAME,DEVICE con show 2>/dev/null | grep ":${iface}$" | cut -d: -f1 | head -1)"
    if [ -n "$conn" ]; then
      method="$(nmcli -g ipv4.method con show "$conn" 2>/dev/null || true)"
      [ "$method" = "manual" ] && return 0
    fi
  fi

  return 1
}

configure_static_ip_netplan() {
  local iface="$1"
  local cidr="$2"
  local gateway="$3"
  shift 3
  local dns
  local dns_block=""

  mkdir -p /etc/netplan/streamrelay-backup
  cp -a /etc/netplan/*.yaml /etc/netplan/streamrelay-backup/ 2>/dev/null || true
  cp -a /etc/netplan/*.yml /etc/netplan/streamrelay-backup/ 2>/dev/null || true

  if [ "$#" -eq 0 ]; then
    dns_block="          - 1.1.1.1
          - 8.8.8.8"
  else
    for dns in "$@"; do
      [ -n "$dns" ] || continue
      dns_block="${dns_block}          - ${dns}
"
    done
  fi

  cat > /etc/netplan/99-streamrelay-static.yaml <<EOF
# StreamRelay — IP ثابت (أُنشئ تلقائياً عند التثبيت)
network:
  version: 2
  ethernets:
    ${iface}:
      dhcp4: false
      dhcp6: false
      addresses:
        - ${cidr}
      routes:
        - to: default
          via: ${gateway}
      nameservers:
        addresses:
${dns_block}
EOF
  chmod 600 /etc/netplan/99-streamrelay-static.yaml
  netplan generate
  netplan apply
}

configure_static_ip_nmcli() {
  local iface="$1"
  local cidr="$2"
  local gateway="$3"
  shift 3
  local conn dns_str=""

  conn="$(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep ":${iface}$" | cut -d: -f1 | head -1)"
  [ -z "$conn" ] && conn="$(nmcli -t -f NAME,DEVICE con show 2>/dev/null | grep ":${iface}$" | cut -d: -f1 | head -1)"
  [ -n "$conn" ] || return 1

  if [ "$#" -eq 0 ]; then
    dns_str="1.1.1.1,8.8.8.8"
  else
    local first=1
    for dns in "$@"; do
      [ -n "$dns" ] || continue
      if [ "$first" -eq 1 ]; then
        dns_str="$dns"
        first=0
      else
        dns_str="${dns_str},${dns}"
      fi
    done
  fi
  [ -n "$dns_str" ] || dns_str="1.1.1.1,8.8.8.8"

  nmcli con mod "$conn" ipv4.method manual ipv4.addresses "$cidr" ipv4.gateway "$gateway" ipv4.dns "$dns_str"
  nmcli con up "$conn"
}

pin_server_network_config() {
  local install_dir="$1"
  local ip="$2"
  local iface="$3"

  cat > "${install_dir}/.streamrelay-network" <<EOF
# StreamRelay — IP مثبّت عند التثبيت (لا تحذف)
SERVER_IP=${ip}
INTERFACE=${iface}
CONFIGURED_AT=$(date -Iseconds)
EOF
  chmod 600 "${install_dir}/.streamrelay-network"
}

apply_persistent_lan_ip() {
  local install_dir="${1:-/opt/streamrelay}"

  if [ "${STREAMRELAY_SKIP_STATIC_IP:-}" = "1" ]; then
    echo "      تخطي IP ثابت (STREAMRELAY_SKIP_STATIC_IP=1)"
    return 0
  fi

  if is_cloud_or_virtual_skip_static; then
    echo "      تخطي IP ثابت — VPS/سحابة (DHCP)"
    return 0
  fi

  local iface cidr ip gateway
  local -a dns_arr=()
  local dns_line

  iface="$(detect_default_route_iface)"
  if [ -z "$iface" ]; then
    echo "      تحذير: لم يُكتشف واجهة شبكة — يُحفظ IP في .env فقط"
    return 0
  fi

  cidr="$(detect_iface_ipv4_cidr "$iface")"
  if [ -z "$cidr" ]; then
    echo "      تحذير: لا يوجد IPv4 على ${iface}"
    return 0
  fi

  ip="${cidr%%/*}"
  gateway="$(detect_default_gateway)"
  if [ -z "$gateway" ]; then
    echo "      تحذير: لا يوجد gateway — تخطي IP ثابت"
    pin_server_network_config "$install_dir" "$ip" "$iface"
    return 0
  fi

  while IFS= read -r dns_line; do
    [ -n "$dns_line" ] && dns_arr+=("$dns_line")
  done < <(detect_dns_servers | head -3)

  if is_static_ip_already "$iface"; then
    echo "      IP ثابت مُعد مسبقاً على ${iface} (${ip}) ✓"
    pin_server_network_config "$install_dir" "$ip" "$iface"
    return 0
  fi

  echo "      تثبيت IP ثابت: ${ip} على ${iface} (gateway ${gateway})..."

  if [ -d /etc/netplan ] && command -v netplan &>/dev/null; then
    configure_static_ip_netplan "$iface" "$cidr" "$gateway" "${dns_arr[@]}"
  elif command -v nmcli &>/dev/null && nmcli general status &>/dev/null 2>&1; then
    configure_static_ip_nmcli "$iface" "$cidr" "$gateway" "${dns_arr[@]}"
  else
    echo "      تحذير: netplan/nmcli غير متوفر — يُحفظ IP في .env فقط"
    pin_server_network_config "$install_dir" "$ip" "$iface"
    return 0
  fi

  pin_server_network_config "$install_dir" "$ip" "$iface"
  echo "      IP ثابت ✓"
}

enable_auto_boot_services() {
  systemctl enable docker.service 2>/dev/null || true
  systemctl start docker.service 2>/dev/null || true
  systemctl enable systemd-networkd-wait-online.service 2>/dev/null || true
  systemctl enable NetworkManager-wait-online.service 2>/dev/null || true
}

try_enable_ac_power_restore() {
  if command -v ipmitool &>/dev/null; then
    if ipmitool chassis status &>/dev/null; then
      if ipmitool chassis policy always-on &>/dev/null; then
        echo "      IPMI: تشغيل تلقائي بعد انقطاع الكهرباء ✓"
        return 0
      fi
    fi
  fi
  return 1
}

print_ac_power_restore_hint() {
  echo ""
  echo "  ── إقلاع تلقائي بعد انقطاع الكهرباء ──"
  echo "  StreamRelay + Docker مفعّلان للتشغيل عند الإقلاع ✓"
  echo "  على الأجهزة الفعلية: فعّل في BIOS/UEFI:"
  echo "    Restore on AC Power Loss = Power On"
  echo "    (أو After Power Loss = Always On)"
  echo ""
}
