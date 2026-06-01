#!/bin/bash
# إصلاح nginx لـ tiangolo/nginx-rtmp (Ubuntu production)
# المشاكل: {36} و (?<name>) يكسران PCRE — auth_request غير مدعوم في هذه الصورة
# الاستخدام: sudo bash scripts/fix-nginx-pcre.sh
# الأفضل بعد git pull: الملفات في المستودع محدّثة مسبقاً
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
cd "$INSTALL_DIR"

echo "=== StreamRelay — إصلاح nginx ==="

fix_regex_file() {
  local f="$1"
  [ -f "$f" ] || return 0
  if ! grep -qE '\(\?<|\(\?P<|\{36\}|auth_request' "$f" 2>/dev/null; then
    echo "  OK (already fixed): $f"
    return 0
  fi
  perl -i -pe '
    s/\(\?P<cid>\[0-9a-f-\]\{36\}\)/([^\/]+)/g;
    s/\(\?<cid>\[0-9a-f-\]\{36\}\)/([^\/]+)/g;
    s/\(\[0-9a-f-\]\{36\}\)/([^\/]+)/g;
    s/\(\?P<file>\[\^\/\]\+\\\.ts\)/([^\/]+\.ts)/g;
    s/\(\?<file>\[\^\/\]\+\\\.ts\)/([^\/]+\.ts)/g;
    s/\(\?P<file>\[\^\/\]\+\\\.m3u8\)/([^\/]+\.m3u8)/g;
    s/\(\?<file>\[\^\/\]\+\\\.m3u8\)/([^\/]+\.m3u8)/g;
    s/\$cid/\$1/g;
    s/\$file/\$2/g;
    s/^\s*auth_request\s+.*\n//g;
    s/^\s*auth_request_set\s+.*\n//g;
  ' "$f"
  # حذف بلوك internal/hls-pulse إن وُجد (auth_request)
  perl -i -0777 -pe 's/\n\s*location ~ \^\/internal\/hls-pulse\/.*?^\s*\}\n//ms' "$f" 2>/dev/null || true
  echo "  patched: $f"
}

fix_regex_file nginx/conf.d/default.conf
fix_regex_file nginx/conf.d/hls-worker.conf
fix_regex_file nginx/conf.d/zz-ssl.conf 2>/dev/null || true

DOMAIN="$(grep '^PUBLIC_BASE_URL=' .env 2>/dev/null | sed 's#.*//##' | cut -d/ -f1 | tr -d '\r' || true)"
DOMAIN="${DOMAIN:-localhost}"
CONF_DIR="${INSTALL_DIR}/nginx/conf.d"

if [ -f "${INSTALL_DIR}/nginx/ssl/fullchain.pem" ]; then
  {
    echo "server {"
    echo "    listen 443 ssl;"
    echo "    listen [::]:443 ssl;"
    echo "    server_name ${DOMAIN} www.${DOMAIN};"
    echo "    ssl_certificate /etc/nginx/ssl/fullchain.pem;"
    echo "    ssl_certificate_key /etc/nginx/ssl/privkey.pem;"
    echo "    ssl_protocols TLSv1.2 TLSv1.3;"
    echo "    ssl_ciphers HIGH:!aNULL:!MD5;"
    sed -n '/server_name _;/,$p' "${CONF_DIR}/default.conf" | tail -n +2
  } > "${CONF_DIR}/zz-ssl.conf"
  cat > docker-compose.override.yml <<'YML'
services:
  nginx:
    ports:
      - "443:443"
YML
  echo "  OK: zz-ssl.conf + port 443"
fi

docker compose run --rm --no-deps nginx nginx -t
docker compose up -d --force-recreate nginx
sleep 3
docker compose ps nginx
curl -s -o /dev/null -w "  /login → HTTP %{http_code}\n" http://127.0.0.1/login || true
echo "  https://${DOMAIN}/login"
