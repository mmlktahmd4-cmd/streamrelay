#!/bin/bash
# يطبّق طلب تغيير الشبكة الذي تكتبه لوحة الإدارة (.network-request) على الجهاز
# يُستدعى من systemd path unit (streamrelay-network.path) أو يدوياً:
#   sudo bash scripts/apply-network-request.sh
set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUEST_FILE="${INSTALL_DIR}/.network-request"
LOG_FILE="${INSTALL_DIR}/.network-request.log"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"; }

[ -f "$REQUEST_FILE" ] || exit 0

if [ "$EUID" -ne 0 ]; then
  log "خطأ: يجب التشغيل كـ root"
  exit 1
fi

# shellcheck source=lib/network.sh
source "${SCRIPT_DIR}/lib/network.sh" 2>/dev/null || true
# shellcheck source=lib/static-ip.sh
source "${SCRIPT_DIR}/lib/static-ip.sh" 2>/dev/null || true

MODE=""; INTERFACE=""; IP=""; PREFIX="24"; GATEWAY=""; DNS=""; REBOOT="0"
# قراءة آمنة لقيم KEY=VALUE فقط
while IFS='=' read -r key val; do
  case "$key" in
    MODE) MODE="$val" ;;
    INTERFACE) INTERFACE="$val" ;;
    IP) IP="$val" ;;
    PREFIX) PREFIX="$val" ;;
    GATEWAY) GATEWAY="$val" ;;
    DNS) DNS="$val" ;;
    REBOOT) REBOOT="$val" ;;
  esac
done < "$REQUEST_FILE"

# إعادة الإقلاع بعد المعالجة إن طُلبت
maybe_reboot() {
  if [ "$REBOOT" = "1" ]; then
    log "إعادة إقلاع السيرفر بعد التطبيق..."
    ( sleep 3; systemctl reboot 2>/dev/null || reboot ) &
  fi
}

# لا نحذف الطلب إلا بعد المعالجة — نحفظ نسخة معالَجة
finish() {
  mv -f "$REQUEST_FILE" "${INSTALL_DIR}/.network-request.done" 2>/dev/null || rm -f "$REQUEST_FILE"
}
trap finish EXIT

log "طلب شبكة: MODE=${MODE} IFACE=${INTERFACE} IP=${IP}/${PREFIX} GW=${GATEWAY} REBOOT=${REBOOT}"

[ -n "$INTERFACE" ] || INTERFACE="$(detect_default_route_iface 2>/dev/null || true)"

DNS_ARGS=()
if [ -n "$DNS" ]; then
  IFS=',' read -ra DNS_ARGS <<< "$DNS"
fi

case "$MODE" in
  static)
    if [ -z "$IP" ] || [ -z "$INTERFACE" ] || [ -z "$GATEWAY" ]; then
      log "خطأ: static يحتاج IP و INTERFACE و GATEWAY"
      exit 1
    fi
    CIDR="${IP}/${PREFIX:-24}"
    if [ -d /etc/netplan ] && command -v netplan &>/dev/null; then
      configure_static_ip_netplan "$INTERFACE" "$CIDR" "$GATEWAY" "${DNS_ARGS[@]}" \
        && log "تم تثبيت IP ثابت ${CIDR} على ${INTERFACE}" \
        || { log "فشل netplan"; exit 1; }
    elif command -v nmcli &>/dev/null; then
      configure_static_ip_nmcli "$INTERFACE" "$CIDR" "$GATEWAY" "${DNS_ARGS[@]}" \
        && log "تم تثبيت IP ثابت ${CIDR} عبر NetworkManager" \
        || { log "فشل nmcli"; exit 1; }
    else
      log "خطأ: لا netplan ولا nmcli"
      exit 1
    fi
    pin_server_network_config "$INSTALL_DIR" "$IP" "$INTERFACE" 2>/dev/null || true
    if [ "$REBOOT" = "1" ]; then
      maybe_reboot
    else
      bash "${SCRIPT_DIR}/fix-server-ip.sh" "$IP" || true
    fi
    ;;

  dhcp)
    rm -f /etc/netplan/99-streamrelay-static.yaml 2>/dev/null || true
    rm -f "${INSTALL_DIR}/.streamrelay-network" 2>/dev/null || true
    if command -v netplan &>/dev/null; then
      netplan apply 2>/dev/null || log "تحذير: netplan apply فشل"
    fi
    if command -v nmcli &>/dev/null && [ -n "$INTERFACE" ]; then
      CONN="$(nmcli -t -f NAME,DEVICE con show 2>/dev/null | grep ":${INTERFACE}$" | cut -d: -f1 | head -1)"
      if [ -n "$CONN" ]; then
        nmcli con mod "$CONN" ipv4.method auto ipv4.addresses "" ipv4.gateway "" 2>/dev/null || true
        nmcli con up "$CONN" 2>/dev/null || true
      fi
    fi
    log "تم التحويل إلى DHCP — انتظار عنوان جديد..."
    sleep 6
    if [ "$REBOOT" = "1" ]; then
      maybe_reboot
    else
      bash "${SCRIPT_DIR}/fix-server-ip.sh" --detect || true
    fi
    ;;

  reboot)
    # لا تغيير شبكة — .env و DB محدّثان مسبقاً، فقط إعادة إقلاع
    REBOOT="1"
    maybe_reboot
    ;;

  *)
    log "MODE غير معروف: ${MODE}"
    exit 1
    ;;
esac

log "اكتمل تطبيق طلب الشبكة"
