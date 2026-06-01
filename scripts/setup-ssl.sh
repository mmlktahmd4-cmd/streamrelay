#!/bin/bash
# StreamRelay — تركيب شهادة SSL مجانية (Let's Encrypt) للدومين وتفعيل HTTPS تلقائياً
# الاستخدام:
#   sudo bash scripts/setup-ssl.sh example.com
#   sudo bash scripts/setup-ssl.sh example.com --no-www        (بدون www)
#   sudo bash scripts/setup-ssl.sh example.com --email you@x.com
#
# يقوم بـ:
#   1) تثبيت certbot إن لزم
#   2) الحصول على شهادة للدومين (و www إن توفّر)
#   3) نسخ الشهادة إلى nginx/ssl وإنشاء إعداد 443 محلي (لا يتأثر بتحديثات GitHub)
#   4) فتح المنفذ 443 في Docker وإعادة تشغيل nginx
#   5) تفعيل HTTPS في روابط اللوحة تلقائياً (إعداد site في قاعدة البيانات)
#   6) ضبط تجديد تلقائي يُحدّث nginx
set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
DOMAIN=""
WANT_WWW=1
EMAIL=""

log()  { echo "[ssl] $*"; }
fail() { echo "[ssl] خطأ: $*" >&2; exit 1; }

# ── قراءة الوسائط ──
for arg in "$@"; do
  case "$arg" in
    --no-www) WANT_WWW=0 ;;
    --email) ;; # يُعالَج أدناه
    --email=*) EMAIL="${arg#*=}" ;;
    --*) ;;
    *) [ -z "$DOMAIN" ] && DOMAIN="$arg" ;;
  esac
done
# دعم: --email you@x.com (قيمة منفصلة)
prev=""
for arg in "$@"; do
  [ "$prev" = "--email" ] && EMAIL="$arg"
  prev="$arg"
done

[ "$EUID" -eq 0 ] || fail "شغّل كـ root:  sudo bash scripts/setup-ssl.sh <domain>"
[ -n "$DOMAIN" ] || fail "أدخل اسم الدومين:  sudo bash scripts/setup-ssl.sh example.com"

# تنظيف الدومين (إزالة البروتوكول/المسار)
DOMAIN="$(echo "$DOMAIN" | sed -E 's#^https?://##; s#/.*$##; s#:.*$##' | tr 'A-Z' 'a-z')"

cd "$INSTALL_DIR" || fail "مجلد التثبيت غير موجود: $INSTALL_DIR"
[ -f docker-compose.yml ] || fail "docker-compose.yml غير موجود في $INSTALL_DIR"

command -v docker &>/dev/null || fail "docker غير مثبت"

# ── 1) certbot ──
if ! command -v certbot &>/dev/null; then
  log "تثبيت certbot..."
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y certbot >/tmp/certbot-install.log 2>&1 \
    || fail "فشل تثبيت certbot — راجع /tmp/certbot-install.log"
fi

# ── 2) الحصول على الشهادة (standalone — يوقف nginx لثوانٍ لتحرير المنفذ 80) ──
DOMAIN_ARGS=(-d "$DOMAIN")
if [ "$WANT_WWW" = "1" ]; then
  DOMAIN_ARGS+=(-d "www.$DOMAIN")
fi

EMAIL_ARGS=(--register-unsafely-without-email)
if [ -n "$EMAIL" ]; then
  EMAIL_ARGS=(-m "$EMAIL")
fi

log "طلب الشهادة لـ $DOMAIN ${WANT_WWW:+(+ www)}..."
docker compose stop nginx >/dev/null 2>&1 || true
certbot certonly --standalone "${DOMAIN_ARGS[@]}" \
  --non-interactive --agree-tos "${EMAIL_ARGS[@]}" \
  --preferred-challenges http
CERT_RESULT=$?
docker compose start nginx >/dev/null 2>&1 || true

LIVE_DIR="/etc/letsencrypt/live/${DOMAIN}"
if [ "$CERT_RESULT" -ne 0 ] || [ ! -f "${LIVE_DIR}/fullchain.pem" ]; then
  log "تعذّر الحصول على الشهادة. أسباب شائعة:"
  log "  • سجل DNS (A) للدومين لا يشير إلى IP هذا السيرفر بعد"
  log "  • المنفذ 80 محجوب من جدار مزوّد الـ VPS (Cloud Firewall)"
  fail "فشل إصدار الشهادة لـ $DOMAIN"
fi

# ── 3) نسخ الشهادة + إعداد nginx للمنفذ 443 (ملف محلي لا يُلمس عند تحديث GitHub) ──
log "نسخ الشهادة وإعداد nginx..."
mkdir -p "${INSTALL_DIR}/nginx/ssl"
cp -L "${LIVE_DIR}/fullchain.pem" "${INSTALL_DIR}/nginx/ssl/fullchain.pem"
cp -L "${LIVE_DIR}/privkey.pem"   "${INSTALL_DIR}/nginx/ssl/privkey.pem"
chmod 644 "${INSTALL_DIR}/nginx/ssl/fullchain.pem"
chmod 600 "${INSTALL_DIR}/nginx/ssl/privkey.pem"

CONF_DIR="${INSTALL_DIR}/nginx/conf.d"
{
  echo "server {"
  echo "    listen 443 ssl;"
  echo "    listen [::]:443 ssl;"
  echo "    server_name ${DOMAIN}${WANT_WWW:+ www.${DOMAIN}};"
  echo "    ssl_certificate /etc/nginx/ssl/fullchain.pem;"
  echo "    ssl_certificate_key /etc/nginx/ssl/privkey.pem;"
  echo "    ssl_protocols TLSv1.2 TLSv1.3;"
  echo "    ssl_ciphers HIGH:!aNULL:!MD5;"
  # نسخ كل location/الإعدادات من إعداد المنفذ 80 (يتفادى التكرار اليدوي والانحراف)
  sed -n '/server_name _;/,$p' "${CONF_DIR}/default.conf" | tail -n +2
} > "${CONF_DIR}/zz-ssl.conf"

# ── 4) فتح المنفذ 443 في Docker عبر ملف override محلي ──
OVERRIDE="${INSTALL_DIR}/docker-compose.override.yml"
if [ ! -f "$OVERRIDE" ] || ! grep -q '443:443' "$OVERRIDE" 2>/dev/null; then
  cat > "$OVERRIDE" <<'YML'
services:
  nginx:
    ports:
      - "443:443"
YML
fi

log "التحقق من إعداد nginx..."
if ! docker compose exec -T nginx nginx -t 2>/dev/null; then
  log "تحذير: nginx -t أبلغ تحذيراً (متابعة)"
fi

log "إعادة تشغيل nginx بالمنفذ 443..."
docker compose up -d nginx >/dev/null 2>&1 || fail "فشل إعادة تشغيل nginx"

# ── 5) تفعيل HTTPS في روابط اللوحة تلقائياً (إعداد site في DB) ──
log "تفعيل HTTPS في روابط اللوحة..."
PG_USER="$(grep -E '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2-)"
PG_DB="$(grep -E '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2-)"
PG_USER="${PG_USER:-streamrelay}"
PG_DB="${PG_DB:-streamrelay}"
SITE_JSON="{\"public_domain\":\"${DOMAIN}\",\"use_https\":true}"
docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -c \
  "INSERT INTO settings (key, value, updated_at) VALUES ('site', '${SITE_JSON}'::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();" \
  >/dev/null 2>&1 && log "تم تفعيل HTTPS في الإعدادات ✓" \
  || log "تحذير: فعّل HTTPS يدوياً من اللوحة (صفحة «ربط دومين»)"

# تحديث ذاكرة الروابط في الـ API
docker compose up -d --force-recreate api >/dev/null 2>&1 || true

# ── 6) تجديد تلقائي يُحدّث nginx ──
HOOK_DIR="/etc/letsencrypt/renewal-hooks/deploy"
mkdir -p "$HOOK_DIR"
cat > "${HOOK_DIR}/streamrelay-nginx.sh" <<EOF
#!/bin/bash
# StreamRelay — يُنسخ بعد تجديد الشهادة ثم يُعاد تحميل nginx
cp -L "${LIVE_DIR}/fullchain.pem" "${INSTALL_DIR}/nginx/ssl/fullchain.pem" 2>/dev/null || true
cp -L "${LIVE_DIR}/privkey.pem"   "${INSTALL_DIR}/nginx/ssl/privkey.pem"   2>/dev/null || true
cd "${INSTALL_DIR}" && docker compose exec -T nginx nginx -s reload 2>/dev/null || docker compose restart nginx 2>/dev/null || true
EOF
chmod +x "${HOOK_DIR}/streamrelay-nginx.sh"

echo ""
log "════════════════════════════════════════"
log "تم تفعيل HTTPS بنجاح ✓"
log "  https://${DOMAIN}/login"
log "  https://${DOMAIN}/watch/login"
[ "$WANT_WWW" = "1" ] && log "  (و www.${DOMAIN})"
log "التجديد التلقائي مُفعّل (certbot) ويُحدّث nginx تلقائياً."
log "════════════════════════════════════════"
