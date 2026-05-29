#!/bin/bash
# تشخيص شامل لـ StreamRelay — يطبع كل ما نحتاجه لتحديد سبب توقف البث / السيرفرات غير متصلة
# الاستخدام: cd /opt/streamrelay && sudo bash scripts/doctor.sh
set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
cd "$INSTALL_DIR" 2>/dev/null || { echo "لا يوجد $INSTALL_DIR"; exit 1; }

PG_USER="$(grep -E '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2- || echo streamrelay)"
PG_DB="$(grep -E '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2- || echo streamrelay)"
PG_USER="${PG_USER:-streamrelay}"
PG_DB="${PG_DB:-streamrelay}"

line() { printf '\n========== %s ==========\n' "$1"; }

psql_q() {
  docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -P pager=off -c "$1" 2>&1
}

line "1) الإصدار الحالي (git)"
git log -1 --oneline 2>&1
echo "INSTALL_SCRIPT_VERSION في الريبو:"
grep -E '^INSTALL_SCRIPT_VERSION=' scripts/ubuntu-quick-install.sh 2>/dev/null || true

line "2) حالة الحاويات"
docker compose ps 2>&1

line "3) إعدادات .env المهمة"
grep -E '^(SERVER_ID|SERVER_IP|SERVER_ROLE|PUBLIC_BASE_URL|HLS_BASE_URL|POSTGRES_PUBLISH|REDIS_PUBLISH|REDIS_PASSWORD)=' .env 2>/dev/null \
  | sed -E 's/(REDIS_PASSWORD=).*/\1***/' || true

line "4) جدول السيرفرات (متصل؟ آخر heartbeat؟ IP؟)"
psql_q "SELECT name, hostname, role, is_active, ip_address, current_streams, max_streams,
        EXTRACT(EPOCH FROM (NOW()-last_heartbeat))::int AS heartbeat_age_sec,
        metadata->'host_stats'->>'collected_at' AS stats_at
        FROM servers ORDER BY name;"

line "5) عدد القنوات حسب الحالة"
psql_q "SELECT status, COUNT(*) FROM channels WHERE is_active=true GROUP BY status ORDER BY status;"

line "6) عينة من القنوات (آخر خطأ + السيرفر المربوطة به)"
psql_q "SELECT c.name, c.status, c.server_id, s.hostname AS server, c.pid,
        LEFT(COALESCE(c.last_error,''),60) AS last_error
        FROM channels c LEFT JOIN servers s ON s.id=c.server_id
        WHERE c.is_active=true ORDER BY c.updated_at DESC LIMIT 15;"

line "7) سجل worker (آخر 40 سطر — ابحث عن inet / heartbeat / FFmpeg)"
docker compose logs worker --tail 40 2>&1

line "8) سجل api (آخر 20 سطر)"
docker compose logs api --tail 20 2>&1

line "9) عمليات FFmpeg الفعلية"
echo "عدد عمليات ffmpeg: $(pgrep -c ffmpeg 2>/dev/null || echo 0)"

line "10) فحص HLS عبر nginx محلياً"
SLUG="$(psql_q "SELECT slug FROM channels WHERE status='running' AND is_active=true LIMIT 1;" | sed -n '3p' | tr -d ' ')"
if [ -n "${SLUG:-}" ]; then
  echo "أول قناة شغّالة: $SLUG"
  curl -s -o /dev/null -w "  /api/hls عبر nginx → HTTP %{http_code}\n" \
    "http://127.0.0.1:${STREAMRELAY_HTTP_PORT:-80}/api/hls/${SLUG}/index.m3u8" 2>&1 || true
  echo "  ملفات على القرص:"
  ls -la "/var/www/hls/${SLUG}" 2>&1 | head -6 || docker compose exec -T worker ls -la "/var/www/hls/${SLUG}" 2>&1 | head -6
else
  echo "لا توجد قناة بحالة running."
fi

line "تم التشخيص"
echo "انسخ المخرجات كاملة وأرسلها."
