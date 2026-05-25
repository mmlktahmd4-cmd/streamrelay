#!/bin/bash
# ─────────────────────────────────────────────────────────────
# StreamRelay — تثبيت سريع على Ubuntu 22.04 / 24.04 LTS
# الاستخدام:  sudo bash scripts/ubuntu-quick-install.sh
# ─────────────────────────────────────────────────────────────
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
chmod +x "${SCRIPT_DIR}"/*.sh 2>/dev/null || true

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

public_base_url() {
  local ip="$1"
  local port="$2"
  if [ "$port" = "80" ]; then
    echo "http://${ip}"
  else
    echo "http://${ip}:${port}"
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
echo "=============================================="

# ── 1. متطلبات النظام ──
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg openssl tar gzip rsync git iproute2

if ! command -v docker &>/dev/null; then
  echo "[1/7] تثبيت Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  echo "[1/7] Docker موجود ✓"
fi

if ! docker compose version &>/dev/null; then
  apt-get install -y -qq docker-compose-plugin
fi

# ── 2. نسخ المشروع ──
echo "[2/7] تجهيز $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"

if [ "$SOURCE_DIR" != "$INSTALL_DIR" ]; then
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

cd "$INSTALL_DIR"
chmod +x scripts/*.sh 2>/dev/null || true

# ── 3. ملف البيئة ──
echo "[3/7] إعداد .env ..."
SERVER_IP="$(hostname -I | tr ' ' '\n' | grep '^192\.168\.' | head -1)"
SERVER_IP="${SERVER_IP:-$(hostname -I | tr ' ' '\n' | grep -v '^172\.' | head -1)}"
SERVER_IP="${SERVER_IP:-$(hostname -I | awk '{print $1}')}"
SERVER_LAN_SUBNET="$(echo "$SERVER_IP" | awk -F. '{print $1"."$2"."$3".0/24}')"
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

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

HLS_OUTPUT_DIR=/var/www/hls
VOD_DIR=/var/www/vod
MPEGTS_OUTPUT_DIR=/var/www/mpegts
FFMPEG_PATH=/usr/bin/ffmpeg
MAX_CONCURRENT_STREAMS=200
HEALTH_CHECK_INTERVAL=5
MAX_RESTART_ATTEMPTS=0
RESTART_COOLDOWN=2

STREAMRELAY_HTTP_PORT=${HTTP_PORT}
SERVER_IP=${SERVER_IP}
SERVER_LAN_SUBNET=${SERVER_LAN_SUBNET}
PUBLIC_BASE_URL=${BASE_URL}
RTMP_INGEST_URL=rtmp://${SERVER_IP}:1935/live
HLS_BASE_URL=${BASE_URL}/hls
ALLOWED_ORIGINS=${BASE_URL},http://${SERVER_IP},http://${SERVER_IP}:5173,http://localhost

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
  echo "      .env موجود — تحديث المنفذ والعناوين فقط"
  grep -q '^STREAMRELAY_HTTP_PORT=' .env \
    && sed -i "s|^STREAMRELAY_HTTP_PORT=.*|STREAMRELAY_HTTP_PORT=${HTTP_PORT}|" .env \
    || echo "STREAMRELAY_HTTP_PORT=${HTTP_PORT}" >> .env
  grep -q '^SERVER_LAN_SUBNET=' .env \
    && sed -i "s|^SERVER_LAN_SUBNET=.*|SERVER_LAN_SUBNET=${SERVER_LAN_SUBNET}|" .env \
    || echo "SERVER_LAN_SUBNET=${SERVER_LAN_SUBNET}" >> .env
  grep -q '^SERVER_IP=' .env \
    && sed -i "s|^SERVER_IP=.*|SERVER_IP=${SERVER_IP}|" .env \
    || echo "SERVER_IP=${SERVER_IP}" >> .env
  grep -q '^PUBLIC_BASE_URL=' .env \
    && sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=${BASE_URL}|" .env \
    || echo "PUBLIC_BASE_URL=${BASE_URL}" >> .env
  grep -q '^HLS_BASE_URL=' .env \
    && sed -i "s|^HLS_BASE_URL=.*|HLS_BASE_URL=${BASE_URL}/hls|" .env \
    || echo "HLS_BASE_URL=${BASE_URL}/hls" >> .env
  ADMIN_PASS="$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2- || echo 'admin123')"
fi

grep -q '^ADMIN_SYNC_PASSWORD=' .env \
  && sed -i 's|^ADMIN_SYNC_PASSWORD=.*|ADMIN_SYNC_PASSWORD=true|' .env \
  || echo "ADMIN_SYNC_PASSWORD=true" >> .env

mkdir -p nginx/ssl data/hls data/vod data/logs

# ── إصلاحات ما قبل Docker ──
if [ -d .git ]; then
  git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
  if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    echo "تحذير: git غير متاح في $INSTALL_DIR"
  elif git fetch origin &>/dev/null && git rev-parse "@{u}" &>/dev/null; then
    git merge --ff-only "@{u}" 2>/dev/null || git pull --ff-only 2>/dev/null || true
  fi
fi

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
echo "[4/7] بناء لوحة التحكم (frontend)..."
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common-install.sh"
build_frontend

# ── 5. بناء وتشغيل Docker ──
echo "[5/7] بناء الحاويات (قد يستغرق 5–15 دقيقة)..."
export STREAMRELAY_HTTP_PORT="${HTTP_PORT}"
docker compose pull postgres redis nginx 2>/dev/null || true
docker compose build --parallel
docker compose up -d

# ── 6. انتظار جاهزية API ──
echo "[6/7] انتظار تشغيل السيرفر..."
if ! wait_for_api 60 3; then
  echo "تحذير: API لم يستجب بعد — تحقق: docker compose logs api"
fi

# ── 7. systemd (تشغيل تلقائي بعد إعادة التشغيل) ──
echo "[7/7] تفعيل التشغيل التلقائي..."
cat > /etc/systemd/system/streamrelay.service <<UNIT
[Unit]
Description=StreamRelay IPTV (Docker Compose)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

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
