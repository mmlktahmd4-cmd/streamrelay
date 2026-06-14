# ═══════════════════════════════════════════════════════════════
# StreamRelay — استعادة إعداد البث على MikroTik
# Winbox → New Terminal → الصق → Enter
# ═══════════════════════════════════════════════════════════════

# ── 1) تنظيف قواعد البث القديمة ──
/ip firewall filter remove [find where comment~"stream|StreamRelay|بث:"]
/ip firewall address-list remove [find where list~"stream"]
/ip firewall mangle remove [find where comment~"stream|StreamRelay|بث:"]
/ip firewall nat remove [find where comment~"stream|StreamRelay|بث:"]
/routing rule remove [find where comment~"stream|StreamRelay|بث:"]
/ip route remove [find where comment~"StreamRelay|stream-local"]

# ── 2) بث: عملاء → سيرفر البث (Hotspot + PPPoE) ──
:if ([:len [/ip firewall mangle find where comment="بث: السماح للعملاء بالوصول لسيرفر البث محليا"]] = 0) do={
  /ip firewall mangle add chain=prerouting dst-address=10.10.10.0/24 action=accept comment="بث: السماح للعملاء بالوصول لسيرفر البث محليا" place-before=0
}

# ── 3) بث: إنternet السيرفر عبر Starlink ──
:if ([:len [/routing rule find where comment="بث: إنternet السيرفر عبر Starlink"]] = 0) do={
  /routing rule add src-address=10.10.10.25 action=lookup-only-in-table table=STAR-2 comment="بث: إنternet السيرفر عبر Starlink"
}
:if ([:len [/ip firewall nat find where comment="بث: NAT السيرفر خارج Starlink"]] = 0) do={
  /ip firewall nat add chain=srcnat src-address=10.10.10.25 out-interface=ether2 action=masquerade comment="بث: NAT السيرفر خارج Starlink"
}

# ── 4) تحقق ──
:put "=== mangle ==="
/ip firewall mangle print where comment~"بث:"
:put "=== routing rule ==="
/routing rule print where comment~"بث:"
:put "=== nat ==="
/ip firewall nat print where comment~"بث:"
:put "=== ping سيرفر البث ==="
/ping 10.10.10.25 count=3
:put "=== ping Starlink ==="
/ping 10.0.0.1 count=3
:put "=== تم ==="
