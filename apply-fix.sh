#!/bin/bash
# ============================================================
# StreamRelay — تطبيق كل إصلاحات تشغيل القنوات على السيرفر مباشرة
# ============================================================
# يطبّق: حلقة EOF + دعم Xtream + إقلاع أسرع + حدّ إعادة المحاولة.
# آمن: نسخة احتياطية + فحص نحوي + استعادة تلقائية عند الفشل.
# الاستخدام:  cd /opt/streamrelay && sudo bash apply-fix.sh
# ============================================================
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/streamrelay}"
cd "$INSTALL_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
F=backend/src/services/stream.service.js

[ -f "$F" ] || { echo "✗ شغّل داخل $INSTALL_DIR"; exit 1; }
echo "=== StreamRelay: تطبيق الإصلاحات ==="
cp "$F" "$F.bak-$STAMP"

# 1) حلقة EOF: حذف السطر المسبّب
grep -q "'-reconnect_at_eof', '1'," "$F" && sed -i "/'-reconnect_at_eof', '1',/d" "$F" && echo "✓ حلقة EOF" || echo "• EOF مطبّق مسبقاً"

# 2) دعم Xtream: multiple_requests بعد rw_timeout
grep -q "'-multiple_requests'" "$F" || sed -i "s/'-rw_timeout', '20000000',/'-rw_timeout', '20000000',\n      '-multiple_requests', '1',/" "$F" && echo "✓ دعم Xtream"

# 3) قصر live_start_index على hls
grep -q "if (inputType === 'hls') {" "$F" || perl -0pi -e "s/if \(\['hls', 'http', 'm3u'\]\.includes\(inputType\)\) \{\s*args\.push\('-live_start_index', '-3'\);\s*\}/if (inputType === 'hls') {\n    args.push('-live_start_index', '-3');\n  }/s" "$F"
echo "✓ live_start_index"

# 4) إقلاع أسرع: 500ms -> 250ms
sed -i 's/setTimeout(resolve, 500)/setTimeout(resolve, 250)/' "$F" && echo "✓ إقلاع أسرع"

# 5) حدّ إعادة المحاولة في .env
if grep -q "^MAX_RESTART_ATTEMPTS=" .env 2>/dev/null; then
  sed -i 's/^MAX_RESTART_ATTEMPTS=.*/MAX_RESTART_ATTEMPTS=10/' .env
else
  echo "MAX_RESTART_ATTEMPTS=10" >> .env
fi
echo "✓ حدّ إعادة المحاولة (10)"

# فحص نحوي + استعادة عند الفشل
echo "--- فحص نحوي ---"
if docker compose exec -T worker node --check src/services/stream.service.js 2>/tmp/chk; then
  echo "✓ سليم — إعادة التشغيل"
  docker compose restart worker api
  sleep 3
  docker compose restart nginx
  sleep 2
  curl -s -o /dev/null -w "API: %{http_code}\n" http://localhost/api/health
  echo "=== تم ✓ ==="
else
  echo "✗ خطأ نحوي — استعادة النسخة الاحتياطية"
  cp "$F.bak-$STAMP" "$F"
  cat /tmp/chk
  exit 1
fi
