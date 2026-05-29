#!/bin/bash
# ─────────────────────────────────────────────────────────────
# StreamRelay — تثبيت سريع على Ubuntu 22.04 / 24.04 LTS
# الاستخدام:  sudo bash scripts/ubuntu-quick-install.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── bootstrap: مزامنة GitHub قبل أي خطوة (easy-install يفعل هذا عبر install-from-github) ──
if [ -f "${SCRIPT_DIR}/lib/network.sh" ]; then
  # shellcheck source=lib/network.sh
  source "${SCRIPT_DIR}/lib/network.sh"
fi

if [ "$SOURCE_DIR" = "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  if [ -f "$INSTALL_DIR/scripts/ubuntu-quick-install.sh" ] || [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    echo "=============================================="
    echo "  خطأ: git clone لم يستبدل المجلد القديم"
    echo "=============================================="
    echo ""
    echo "  git clone يفشل إذا /opt/streamrelay موجود مسبقاً."
    echo "  الحل — احذف ثم ثبّت:"
    echo ""
    echo "    sudo rm -rf /opt/streamrelay"
    echo "    curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/easy-install.sh | sudo bash"
    echo ""
    echo "  أو:"
    echo ""
    echo "    sudo rm -rf /opt/streamrelay"
    echo "    sudo git clone https://github.com/mmlktahmd4-cmd/streamrelay.git /opt/streamrelay"
    echo "    cd /opt/streamrelay && sudo bash scripts/ubuntu-quick-install.sh"
    echo ""
    exit 1
  fi
fi

if [ -d "$INSTALL_DIR/.git" ] && [ "${STREAMRELAY_REPO_SYNCED:-}" != "1" ]; then
  export STREAMRELAY_REPO_SYNCED=1
  if declare -F sync_install_repo >/dev/null 2>&1; then
    sync_install_repo "$INSTALL_DIR" main 2>/dev/null || true
  fi
  exec bash "$INSTALL_DIR/scripts/ubuntu-quick-install.sh" "$@"
fi

INSTALL_SCRIPT_VERSION="2026.05.29-33"
chmod +x "${SCRIPT_DIR}"/*.sh 2>/dev/null || true

load_network_lib() {
  local lib="${1:?}"
  if [ ! -f "$lib" ]; then
    echo "خطأ: ملف network.sh غير موجود: $lib"
    echo "احذف المجلد القديم ثم استنسخ من GitHub:"
    echo "  sudo rm -rf ${INSTALL_DIR}"
    echo "  sudo git clone https://github.com/mmlktahmd4-cmd/streamrelay.git ${INSTALL_DIR}"
    exit 1
  fi
  # shellcheck source=lib/network.sh
  source "$lib"
  if ! declare -F ip_to_subnet >/dev/null 2>&1; then
    echo "خطأ: ip_to_subnet غير معرّف في $lib"
    exit 1
  fi
}

load_network_lib "${SCRIPT_DIR}/lib/network.sh"

static_ip_lib="${SCRIPT_DIR}/lib/static-ip.sh"
if [ -f "$static_ip_lib" ]; then
  # shellcheck source=lib/static-ip.sh
  source "$static_ip_lib"
fi

port_in_use() {
  local port="$1"
  ss -tln 2>/dev/null | grep -q ":${port} " || \
  netstat -tln 2>/dev/null | grep -q ":${port} "
}

detect_http_port() {
  if port_in_use 80; then
    if port_in_use 8080; then
      echo "8088"
    else
      echo "8080"
    fi
  else
    echo "80"
  fi
}

if [ "$EUID" -ne 0 ]; then
  echo "شغّل السكربت كـ root:  sudo bash scripts/ubuntu-quick-install.sh"
  exit 1
fi

UBUNTU_VERSION=""
if [ -f /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  UBUNTU_VERSION="${VERSION_ID:-}"
fi

case "$UBUNTU_VERSION" in
  22.04|24.04)
    echo "نظام مدعوم: Ubuntu ${UBUNTU_VERSION} ✓"
    ;;
  "")
    echo "تحذير: لم يُكتشف إصدار Ubuntu — سيتم المتابعة..."
    ;;
  *)
    echo "تحذير: Ubuntu ${UBUNTU_VERSION} غير مختبر رسمياً — يُفضّل 22.04 أو 24.04"
    ;;
esac

HTTP_PORT="$(detect_http_port)"
if [ "$HTTP_PORT" != "80" ]; then
  echo "منفذ 80 مشغول (Apache/Nginx) — StreamRelay سيستخدم المنفذ ${HTTP_PORT}"
fi

echo "=============================================="
echo "  StreamRelay — تثبيت Ubuntu"
echo "  install-scripts: ${INSTALL_SCRIPT_VERSION}"
echo "=============================================="

# ── 1. متطلبات النظام ──
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg openssl tar gzip rsync git iproute2

if ! command -v docker &>/dev/null; then
  echo "[1/8] تثبيت Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  echo "[1/8] Docker موجود ✓"
  systemctl enable docker 2>/dev/null || true
fi

if ! docker compose version &>/dev/null; then
  apt-get install -y -qq docker-compose-plugin
fi

# ── 2. نسخ المشروع ──
echo "[2/8] تجهيز $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"

if [ "$SOURCE_DIR" != "$INSTALL_DIR" ]; then
  if [ -d "$INSTALL_DIR/.git" ]; then
    echo "      git موجود في $INSTALL_DIR — تخطي rsync (لا نستبدل بنسخة قديمة)"
    sync_install_repo "$INSTALL_DIR" main 2>/dev/null || true
  else
    rsync -a --delete \
    --exclude node_modules \
    --exclude backend/node_modules \
    --exclude frontend/node_modules \
    --exclude frontend/dist \
    --exclude .git \
    --exclude data/hls \
    --exclude data/logs \
    "$SOURCE_DIR/" "$INSTALL_DIR/"
  fi
fi

cd "$INSTALL_DIR"
chmod +x scripts/*.sh 2>/dev/null || true

# بعد rsync من مجلد خارجي: تابع من /opt/streamrelay (يتجنب سكربت قديم في الذاكرة)
if [ "$SOURCE_DIR" != "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/scripts/ubuntu-quick-install.sh" ]; then
  if [ "${STREAMRELAY_INSTALL_REEXECED:-}" != "1" ]; then
    export STREAMRELAY_INSTALL_REEXECED=1
    export INSTALL_DIR
    exec bash "$INSTALL_DIR/scripts/ubuntu-quick-install.sh" "$@"
  fi
fi

if [ -d .git ]; then
  sync_install_repo "$INSTALL_DIR" main 2>/dev/null || true
fi

load_network_lib "$INSTALL_DIR/scripts/lib/network.sh"

if [ -f "$INSTALL_DIR/scripts/lib/static-ip.sh" ]; then
  # shellcheck source=lib/static-ip.sh
  source "$INSTALL_DIR/scripts/lib/static-ip.sh"
fi

# ── 3. IP ثابت على الشبكة ──
echo "[3/8] تثبيت IP ثابت (لا يتغير بعد إعادة التشغيل)..."
if declare -F apply_persistent_lan_ip >/dev/null 2>&1; then
  apply_persistent_lan_ip "$INSTALL_DIR"
else
  echo "      تحذير: static-ip.sh غير متوفر — تخطي"
fi

# ── 4. ملف البيئة ──
echo "[4/8] إعداد .env ..."
SERVER_IP="$(resolve_server_ip "$INSTALL_DIR")"
SERVER_LAN_SUBNET="$(ip_to_subnet "$SERVER_IP")"
JWT_SECRET="$(openssl rand -hex 32)"
JWT_REFRESH="$(openssl rand -hex 32)"
URL_SIGNING="$(openssl rand -hex 32)"
DB_PASS="$(openssl rand -hex 16)"
ADMIN_PASS="${ADMIN_PASSWORD:-$(openssl rand -base64 12 | tr -d '/+=' | head -c 12)}"
BASE_URL="$(public_base_url "$SERVER_IP" "$HTTP_PORT")"

if [ ! -f .env ]; then
  cat > .env <<EOF
NODE_ENV=production
API_PORT=3000
API_HOST=0.0.0.0
SERVER_ID=node-1
SERVER_ROLE=full

JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH}
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
URL_SIGNING_SECRET=${URL_SIGNING}
SIGNED_URL_TTL=3600

POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=streamrelay
POSTGRES_USER=streamrelay
POSTGRES_PASSWORD=${DB_PASS}

POSTGRES_PUBLISH=0.0.0.0:5432
REDIS_PUBLISH=0.0.0.0:6379

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

HLS_OUTPUT_DIR=/var/www/hls
VOD_DIR=/var/www/vod
MPEGTS_OUTPUT_DIR=/var/www/mpegts
FFMPEG_PATH=/usr/bin/ffmpeg
MAX_CONCURRENT_STREAMS=200
HEALTH_CHECK_INTERVAL=15
MAX_RESTART_ATTEMPTS=0
RESTART_COOLDOWN=5
STARTUP_RECOVERY_DELAY_SEC=5

STREAMRELAY_HTTP_PORT=${HTTP_PORT}
SERVER_IP=${SERVER_IP}
SERVER_LAN_SUBNET=${SERVER_LAN_SUBNET}
PUBLIC_BASE_URL=${BASE_URL}
RTMP_INGEST_URL=rtmp://${SERVER_IP}:1935/live
HLS_BASE_URL=${BASE_URL}/api/hls
ALLOWED_ORIGINS=$(allowed_origins_for "${BASE_URL}")

RATE_LIMIT_MAX=300
RATE_LIMIT_WINDOW_MS=60000
STREAM_RATE_LIMIT_MAX=30

LOG_LEVEL=info
LOG_DIR=/var/log/streamrelay

ADMIN_USERNAME=admin
ADMIN_PASSWORD=${ADMIN_PASS}
ADMIN_EMAIL=admin@localhost
ADMIN_SYNC_PASSWORD=true
EOF
  echo "      تم إنشاء .env جديد"
else
  echo "      .env موجود — الحفاظ على SERVER_IP وتحديث الروابط"
  EXISTING_IP="$(grep '^SERVER_IP=' .env 2>/dev/null | cut -d= -f2- || true)"
  if [ -n "$EXISTING_IP" ] && [ "$EXISTING_IP" != "127.0.0.1" ]; then
    SERVER_IP="$EXISTING_IP"
    SERVER_LAN_SUBNET="$(ip_to_subnet "$SERVER_IP")"
  fi
  BASE_URL="$(sync_env_public_urls "$INSTALL_DIR" "$SERVER_IP" "$HTTP_PORT")"
  grep -q '^SERVER_LAN_SUBNET=' .env \
    && sed -i "s|^SERVER_LAN_SUBNET=.*|SERVER_LAN_SUBNET=${SERVER_LAN_SUBNET}|" .env \
    || echo "SERVER_LAN_SUBNET=${SERVER_LAN_SUBNET}" >> .env
  ADMIN_PASS="$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2- || echo 'admin123')"
fi

grep -q '^ADMIN_SYNC_PASSWORD=' .env \
  && sed -i 's|^ADMIN_SYNC_PASSWORD=.*|ADMIN_SYNC_PASSWORD=true|' .env \
  || echo "ADMIN_SYNC_PASSWORD=true" >> .env

grep -q '^POSTGRES_PUBLISH=' .env \
  || echo "POSTGRES_PUBLISH=0.0.0.0:5432" >> .env
grep -q '^REDIS_PUBLISH=' .env \
  || echo "REDIS_PUBLISH=0.0.0.0:6379" >> .env

mkdir -p nginx/ssl data/hls data/vod data/logs

# ── إصلاحات ما قبل Docker ──
if grep -q '^services:  postgres:' docker-compose.yml 2>/dev/null; then
  echo "      إصلاح docker-compose.yml..."
  python3 - <<'PY'
from pathlib import Path
p = Path("docker-compose.yml")
text = p.read_text(encoding="utf-8")
text = text.replace("services:  postgres:", "services:\n\n  postgres:", 1)
p.write_text(text, encoding="utf-8")
PY
fi

if ! docker compose config -q 2>/dev/null; then
  echo "خطأ في docker-compose.yml — نفّذ:"
  echo "  sudo git config --global --add safe.directory $INSTALL_DIR"
  echo "  cd $INSTALL_DIR && sudo git pull"
  echo "  sudo bash scripts/ubuntu-quick-install.sh"
  exit 1
fi

# ── 4. بناء الواجهة ──
echo "[5/8] بناء لوحة التحكم (frontend)..."
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common-install.sh"
build_frontend

# ── 5. بناء وتشغيل Docker ──
echo "[6/8] بناء الحاويات (قد يستغرق 5–15 دقيقة)..."
export STREAMRELAY_HTTP_PORT="${HTTP_PORT}"
docker compose pull postgres redis nginx 2>/dev/null || true
docker compose build --parallel
docker compose up -d

# ── 6. انتظار جاهزية API ──
echo "[7/8] انتظار تشغيل السيرفر..."
if ! wait_for_api 60 3; then
  echo "تحذير: API لم يستجب بعد — تحقق: docker compose logs api"
fi

# ── 8. systemd + إقلاع تلقائي ──
echo "[8/8] تفعيل التشغيل التلقائي بعد الإقلاع..."
if declare -F enable_auto_boot_services >/dev/null 2>&1; then
  enable_auto_boot_services
fi
try_enable_ac_power_restore 2>/dev/null || true

cat > /etc/systemd/system/streamrelay.service <<UNIT
[Unit]
Description=StreamRelay IPTV (Docker Compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=-${INSTALL_DIR}/.env
ExecStartPre=/bin/bash -c 'if [ -x ${INSTALL_DIR}/scripts/fix-server-ip.sh ]; then ${INSTALL_DIR}/scripts/fix-server-ip.sh --no-restart || true; fi'
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable streamrelay.service

# ── MikroTik IP hint ──
echo ""
echo "=============================================="
echo "  تم التثبيت بنجاح!"
echo "=============================================="
echo ""
echo "  Ubuntu:          ${UBUNTU_VERSION:-unknown}"
echo "  لوحة الإدارة:    ${BASE_URL}/login"
echo "  بوابة المشاهدة:  ${BASE_URL}/watch/login"
echo "  API:             ${BASE_URL}/api/health"
if [ "$HTTP_PORT" != "80" ]; then
  echo ""
  echo "  ملاحظة: منفذ 80 مشغول — StreamRelay على المنفذ ${HTTP_PORT}"
fi
echo ""
echo "  المستخدم:  admin"
echo "  كلمة المرور: ${ADMIN_PASS}"
echo ""
echo "  (محفوظة في ${INSTALL_DIR}/.env)"
echo ""
echo "  أوامر مفيدة:"
echo "    cd ${INSTALL_DIR}"
echo "    docker compose ps          # حالة الخدمات"
echo "    docker compose logs -f api # سجل السيرفر"
echo "    docker compose restart     # إعادة تشغيل"
echo ""
echo "  في صفحة MikroTik اكتب IP السيرفر: ${SERVER_IP}"
if [ -n "$SERVER_LAN_SUBNET" ]; then
  echo "  شبكة العملاء (اقتراح): ${SERVER_LAN_SUBNET}"
fi
if declare -F print_ac_power_restore_hint >/dev/null 2>&1; then
  print_ac_power_restore_hint
fi
echo "=============================================="

# حفظ بيانات الدخول
cat > "${INSTALL_DIR}/INSTALL-CREDENTIALS.txt" <<CRED
StreamRelay — بيانات التثبيت
التاريخ: $(date -Iseconds)
Ubuntu: ${UBUNTU_VERSION:-unknown}
العنوان: ${BASE_URL}
admin / ${ADMIN_PASS}
CRED
chmod 600 "${INSTALL_DIR}/INSTALL-CREDENTIALS.txt"
