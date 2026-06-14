# ═══════════════════════════════════════════════════════════════
# StreamRelay — إعداد عبور البث للمشتركين على MikroTik (النسخة النهائية)
# سيرفر البث: 10.10.10.25  |  Winbox > New Terminal > الصق > Enter
# ═══════════════════════════════════════════════════════════════

# ── 1) حذف قاعدة التوجيه التي كانت تكسر رجوع البث للمشتركين ──
#    (كانت تجبر ردود السيرفر على المرور عبر Starlink بدل الرجوع للعميل)
/routing rule remove [find where src-address="10.10.10.25"]

# ── 2) حذف أي NAT تجريبي خاص بـ Starlink (غير مطلوب) ──
/ip firewall nat remove [find where comment~"bth-server-nat-starlink"]

# ── 3) حذف قواعد accept المكررة لتفادي التكرار ──
/ip firewall mangle remove [find where action=accept dst-address=10.10.10.0/24]

# ── 4) القاعدة الوحيدة المطلوبة: عبور المشتركين لسيرفر البث ──
#    accept في أعلى السلسلة (قبل mark-routing) — يخلي طلب
#    الهوت سبوت والبرودباند نحو السيرفر يبقى في الجدول الرئيسي ويوصل محلياً
/ip firewall mangle add chain=prerouting dst-address=10.10.10.0/24 \
  action=accept comment="بث: عبور المشتركين لسيرفر البث 10.10.10.25" place-before=0

# ── 5) تحقق ──
:put "=== قاعدة البث (لازم تكون رقم 0) ==="
/ip firewall mangle print where comment~"بث:"
:put "=== routing rules (لازم لا يوجد 10.10.10.25) ==="
/routing rule print
:put "=== اختبار الوصول للسيرفر ==="
/ping 10.10.10.25 count=3
:put "=== تم — جرّب من مشترك: http://10.10.10.25/watch/login ==="
