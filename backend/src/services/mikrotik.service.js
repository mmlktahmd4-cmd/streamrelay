import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { getSystemMetrics } from '../utils/metrics.js';
import { getPublicUrls, refreshPublicUrlCache } from './public-url.service.js';

const ADDRESS_LIST = 'streamrelay-clients';
const BROADBAND_LIST = 'streamrelay-broadband';
const COMMENT_PREFIX = 'StreamRelay';

/** شبكات PPPoE الافتراضية — عدّلها من إعدادات MikroTik في اللوحة إن لزم */
const DEFAULT_BROADBAND_SUBNETS = ['10.2.0.0/16', '10.4.0.0/16'];

/** جداول توجيه PPPoE — تحقق من PPP > Profiles > Routing Table */
const DEFAULT_BROADBAND_ROUTING_TABLES = ['rtab-3', 'rtab-1', 'STAR-2'];

/** يحوّل 30.30.30.1 → 30.30.30.0/24 */
export function subnetFromServerIp(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return `${nums[0]}.${nums[1]}.${nums[2]}.0/24`;
}

export function buildViewerUrl(serverIp, webPort) {
  const defaultPort = 80;
  const host = webPort === defaultPort ? serverIp : `${serverIp}:${webPort}`;
  return `http://${host}/watch/login`;
}

export function getServerInfo() {
  const metrics = getSystemMetrics();
  const urls = getPublicUrls();

  return {
    detected_ip: urls.detectedIp,
    configured_ip: urls.serverIp,
    api_port: urls.apiPort,
    web_port: urls.webPort,
    public_base_url: urls.baseUrl,
    viewer_url: urls.viewerUrl,
    hostname: metrics.hostname,
  };
}

const DEFAULT_CONFIG = {
  server_ip: '',
};

export async function getMikrotikConfig() {
  const result = await query(`SELECT value FROM settings WHERE key = 'mikrotik'`);
  const stored = result.rows[0]?.value || {};
  const info = getServerInfo();
  const serverIp = stored.server_ip || '';
  const webPort = stored.web_port || info.web_port;
  const clientSubnet = serverIp ? subnetFromServerIp(serverIp) : null;
  const broadbandSubnets = stored.broadband_subnets?.length
    ? stored.broadband_subnets
    : DEFAULT_BROADBAND_SUBNETS;
  const broadbandRoutingTables = stored.broadband_routing_tables?.length
    ? stored.broadband_routing_tables
    : DEFAULT_BROADBAND_ROUTING_TABLES;

  return {
    ...DEFAULT_CONFIG,
    ...stored,
    server_ip: serverIp,
    web_port: webPort,
    api_port: stored.api_port || info.api_port,
    client_subnet: clientSubnet,
    broadband_subnets: broadbandSubnets,
    broadband_routing_tables: broadbandRoutingTables,
    detected: info,
    viewer_url: serverIp ? buildViewerUrl(serverIp, webPort) : null,
    active_urls: {
      base_url: getPublicUrls().baseUrl,
      hls_base: getPublicUrls().hlsBase,
      viewer_url: getPublicUrls().viewerUrl,
      source: getPublicUrls().source,
    },
  };
}

/**
 * يوحّد IP الميكروتك مع IP السيرفر الفعلي (يُستدعى عند ضبط IP من صفحة «IP السيرفر»).
 * يحدّث server_ip و client_subnet دون لمس بقية الحقول، ولا يعيد بناء الكاش (المتصل يفعل ذلك).
 * يُرجع true إذا تغيّرت القيمة فعلاً.
 */
export async function setMikrotikServerIp(ip) {
  const serverIp = String(ip || '').trim();
  if (!serverIp || !subnetFromServerIp(serverIp)) return false;

  const result = await query(`SELECT value FROM settings WHERE key = 'mikrotik'`);
  const current = result.rows[0]?.value || {};
  if (current.server_ip === serverIp) return false;

  const merged = {
    ...current,
    server_ip: serverIp,
    client_subnet: subnetFromServerIp(serverIp),
  };

  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('mikrotik', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [JSON.stringify(merged)]
  );
  return true;
}

export async function saveMikrotikConfig(data) {
  const current = await getMikrotikConfig();
  const serverIp = (data.server_ip ?? current.server_ip)?.trim();

  if (!serverIp || !subnetFromServerIp(serverIp)) {
    throw new Error('أدخل عنوان IP صحيح لجهاز البث (مثل 30.30.30.1)');
  }

  const merged = {
    server_ip: serverIp,
    client_subnet: subnetFromServerIp(serverIp),
    web_port: data.web_port ?? current.web_port ?? getServerInfo().web_port,
    api_port: data.api_port ?? current.api_port ?? config.port,
    broadband_subnets: data.broadband_subnets ?? current.broadband_subnets ?? DEFAULT_BROADBAND_SUBNETS,
    broadband_routing_tables: data.broadband_routing_tables ?? current.broadband_routing_tables ?? DEFAULT_BROADBAND_ROUTING_TABLES,
  };

  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('mikrotik', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [JSON.stringify(merged)]
  );

  await refreshPublicUrlCache();

  return getMikrotikConfig();
}

function buildMainScript(cfg) {
  const ports = [...new Set([cfg.web_port, cfg.api_port].filter(Boolean))].join(',');
  const subnet = cfg.client_subnet || subnetFromServerIp(cfg.server_ip);
  const streamSubnet = subnetFromServerIp(cfg.server_ip);
  const broadbandSubnets = cfg.broadband_subnets?.length
    ? cfg.broadband_subnets
    : DEFAULT_BROADBAND_SUBNETS;
  const routingTables = cfg.broadband_routing_tables?.length
    ? cfg.broadband_routing_tables
    : DEFAULT_BROADBAND_ROUTING_TABLES;
  const streamGateway = streamSubnet
    ? `${cfg.server_ip.split('.').slice(0, 3).join('.')}.1`
    : '10.10.10.1';

  const lines = [
    `# ═══════════════════════════════════════════`,
    `# StreamRelay — إعداد الميكروتك`,
    `# جهاز البث: ${cfg.server_ip}   |   شبكة LAN: ${subnet}`,
    `# انسخ كل السطور والصقها في Terminal الميكروتك ثم Enter`,
    `# ═══════════════════════════════════════════`,
    '',
    '# 1) Hotspot / LAN — السماح بوصول العملاء لجهاز البث',
    '/ip firewall address-list',
    `:if ([:len [/ip firewall address-list find where list=${ADDRESS_LIST} and address=${subnet}]] = 0) do={ add list=${ADDRESS_LIST} address=${subnet} comment="${COMMENT_PREFIX}" }`,
    '/ip firewall filter',
    `:if ([:len [/ip firewall filter find where comment="${COMMENT_PREFIX} LAN"]] = 0) do={ add chain=forward action=accept protocol=tcp src-address-list=${ADDRESS_LIST} dst-address=${cfg.server_ip} dst-port=${ports} comment="${COMMENT_PREFIX} LAN" place-before=0 }`,
    `:if ([:len [/ip firewall filter find where comment="${COMMENT_PREFIX} LAN input"]] = 0) do={ add chain=input action=accept protocol=tcp src-address-list=${ADDRESS_LIST} dst-address=${cfg.server_ip} dst-port=${ports} comment="${COMMENT_PREFIX} LAN input" }`,
    '',
    '# 2) البرودباند (PPPoE) — Hotspot يشتغل لكن PPPoE يحتاج توجيه + جدار ناري',
    '/ip firewall address-list',
  ];

  for (const bb of broadbandSubnets) {
    lines.push(`:if ([:len [/ip firewall address-list find where list=${BROADBAND_LIST} and address=${bb}]] = 0) do={ add list=${BROADBAND_LIST} address=${bb} comment="${COMMENT_PREFIX} PPPoE" }`);
  }

  lines.push(
    '/ip firewall filter',
    `:if ([:len [/ip firewall filter find where comment="${COMMENT_PREFIX} broadband"]] = 0) do={ add chain=forward action=accept protocol=tcp src-address-list=${BROADBAND_LIST} dst-address=${cfg.server_ip} dst-port=${ports} comment="${COMMENT_PREFIX} broadband" place-before=0 }`,
    '',
    '# 3) توجيه شبكة البث في جداول PPPoE (بدونها البرودباند لا يصل لـ ' + cfg.server_ip + ')',
    '/ip route',
  );

  if (streamSubnet) {
    for (const table of routingTables) {
      lines.push(`:if ([:len [/ip route find where dst-address=${streamSubnet} and routing-table=${table} and comment="${COMMENT_PREFIX}"]] = 0) do={ add dst-address=${streamSubnet} gateway=${streamGateway} routing-table=${table} comment="${COMMENT_PREFIX}" }`);
    }
  }

  lines.push(
    '',
    '# 4) (اختياري) حجز IP ثابت لجهاز البث عبر DHCP',
    '# /ip dhcp-server lease',
    `# add address=${cfg.server_ip} mac-address=AA:BB:CC:DD:EE:FF comment="${COMMENT_PREFIX}"`,
    '',
    '# ── تحقق: /ppp profile print  ← اسم routing-table لكل بروفايل',
    `# ── رابط المشاهدة: http://${cfg.server_ip}/watch/login`,
  );

  return lines.join('\n');
}

function buildRemoveScript() {
  return [
    `# حذف إعداد StreamRelay من الميكروتك`,
    `/ip firewall filter remove [find comment~"${COMMENT_PREFIX}"]`,
    `/ip firewall address-list remove [find list=${ADDRESS_LIST}]`,
    `/ip firewall address-list remove [find list=${BROADBAND_LIST}]`,
    `/ip route remove [find comment~"${COMMENT_PREFIX}"]`,
    `/ip dhcp-server lease remove [find comment~"${COMMENT_PREFIX}"]`,
  ].join('\n');
}

export async function generateScripts() {
  const cfg = await getMikrotikConfig();
  const viewerUrl = cfg.viewer_url || buildViewerUrl(cfg.server_ip || '0.0.0.0', cfg.web_port);

  return {
    config: cfg,
    scripts: {
      main: cfg.server_ip ? buildMainScript(cfg) : '# احفظ عنوان IP جهاز البث أولاً لتوليد السكربت',
      remove: buildRemoveScript(),
    },
    links: {
      viewer_url: viewerUrl,
      server_ip: cfg.server_ip,
      client_subnet: cfg.client_subnet,
      web_port: cfg.web_port,
    },
    guide: {
      steps: [
        'في الميكروتك → IP > Addresses: أضف عنوان البوابة على شبكة العملاء (مثال 192.168.5.9/24) على البرidج أو المنفذ المخصّص.',
        'IP > DHCP Server: اضغط Setup وشغّل DHCP على نفس الشبكة ليأخذ العملاء IP تلقائياً.',
        cfg.server_ip
          ? `ثبّت IP جهاز البث على ${cfg.server_ip}: إمّا من صفحة «IP السيرفر» في اللوحة (IP ثابت)، أو احجزه في IP > DHCP Server > Leases (Make Static).`
          : 'ثبّت IP جهاز البث: من صفحة «IP السيرفر» (ثابت) أو احجزه في DHCP Leases (Make Static).',
        '(اختياري) لمنفذ مخصّص للسيرفر فقط: Bridge > Ports — احذف المنفذ (مثل ether3) من البرidج، ثم ضع عليه عنوان البوابة و DHCP.',
        'اكتب نفس IP جهاز البث في الأعلى هنا واضغط حفظ، ثم «نسخ السكربت».',
        'Winbox → New Terminal → الصق السكربت → Enter (يفتح الجدار الناري).',
        cfg.server_ip ? `أعطِ العملاء رابط المشاهدة: ${viewerUrl}` : 'أعطِ العملاء رابط المشاهدة بعد حفظ الـ IP.',
        'إذا Hotspot يشتغل والبرودباند (PPPoE) لا: الصق السكربت — يضيف توجيه 10.10.10.0/24 لجداول PPPoE + جدار ناري.',
      ],
      notes: [
        'مهم: IP جهاز البث في الميكروتك يجب أن يطابق المثبّت في اللوحة تماماً — وإلا لن يصل البث للعملاء.',
        'Hotspot على bridge يصل للبث مباشرة؛ مشتركو PPPoE يستخدمون routing-table منفصل — بدون route لشبكة البث لا يفتح 10.10.10.x.',
        'تحقق من أسماء routing-table: PPP > Profiles → Routing Table — عدّل broadband_routing_tables إن اختلفت.',
        'للإعداد البسيط (السيرفر والعملاء على نفس الشبكة): لا تحذف أي منفذ من البرidج — فقط احجز IP السيرفر وافتح الجدار الناري.',
        'احذف منفذاً من البرidج فقط إذا أردت شبكة منفصلة للسيرفر — عندها سكربت forward يسمح بالعبور بين الشبكتين تلقائياً.',
        'لا تترك السيرفر يأخذ IP عشوائياً من DHCP — استخدم IP ثابت أو حجز (Static Lease) ليبقى مطابقاً للوحة.',
        cfg.server_ip ? `IP جهاز البث الحالي: ${cfg.server_ip}` : 'لم يُحدّد IP جهاز البث بعد',
        cfg.client_subnet ? `شبكة العملاء (تلقائي): ${cfg.client_subnet} — كل الأجهزة على هذه الشبكة` : '',
        cfg.server_ip ? `رابط العملاء: ${viewerUrl}` : '',
      ].filter(Boolean),
    },
  };
}

// IP rules — kept for API compatibility
export async function listIpRules() {
  const result = await query(
    `SELECT * FROM ip_rules WHERE is_active = true ORDER BY created_at DESC`
  );
  return result.rows;
}

export async function createIpRule({ ip_address, rule_type, description }) {
  const result = await query(
    `INSERT INTO ip_rules (ip_address, rule_type, description) VALUES ($1, $2, $3) RETURNING *`,
    [ip_address, rule_type, description || null]
  );
  return result.rows[0];
}

export async function deleteIpRule(id) {
  await query(`UPDATE ip_rules SET is_active = false WHERE id = $1`, [id]);
}
