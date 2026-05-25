import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { getSystemMetrics } from '../utils/metrics.js';
import { getPublicUrls, refreshPublicUrlCache } from './public-url.service.js';

const ADDRESS_LIST = 'streamrelay-clients';
const COMMENT_PREFIX = 'StreamRelay';

/** يحوّل 30.30.30.1 → 30.30.30.0/24 */
export function subnetFromServerIp(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return `${nums[0]}.${nums[1]}.${nums[2]}.0/24`;
}

export function buildViewerUrl(serverIp, webPort) {
  return `http://${serverIp}:${webPort}/watch/login`;
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

  return {
    ...DEFAULT_CONFIG,
    ...stored,
    server_ip: serverIp,
    web_port: webPort,
    api_port: stored.api_port || info.api_port,
    client_subnet: clientSubnet,
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
  const ports = [...new Set([cfg.api_port, cfg.web_port])].join(',');
  const subnet = cfg.client_subnet || subnetFromServerIp(cfg.server_ip);

  return [
    `# StreamRelay - فتح الوصول لجهاز البث`,
    `# جهاز البث (IP ثابت): ${cfg.server_ip}`,
    `# شبكة العملاء: ${subnet}`,
    `# انسخ كل السطور والصقها في Terminal الميكروتik ثم Enter`,
    '',
    '/ip firewall address-list',
    `add list=${ADDRESS_LIST} address=${subnet} comment="${COMMENT_PREFIX}"`,
    '',
    '/ip firewall filter',
    `add chain=forward action=accept protocol=tcp src-address-list=${ADDRESS_LIST} dst-address=${cfg.server_ip} dst-port=${ports} comment="${COMMENT_PREFIX}"`,
    `add chain=input action=accept protocol=tcp src-address-list=${ADDRESS_LIST} dst-address=${cfg.server_ip} dst-port=${ports} comment="${COMMENT_PREFIX}"`,
  ].join('\n');
}

function buildRemoveScript() {
  return [
    `# حذف إعداد StreamRelay من الميكروتik`,
    `/ip firewall filter remove [find comment~"${COMMENT_PREFIX}"]`,
    `/ip firewall address-list remove [find list=${ADDRESS_LIST}]`,
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
        'على جهاز البث (Windows): Network → IP ثابت — مثلاً 30.30.30.1',
        'في الأسفل اكتب نفس IP جهاز البث ثم اضغط حفظ.',
        'اضغط «نسخ السكربت».',
        'Winbox → New Terminal → الصق السكربت → Enter.',
        'أعطِ العملاء رابط المشاهدة (نفس IP جهاز البث).',
      ],
      notes: [
        cfg.server_ip
          ? `IP جهاز البث: ${cfg.server_ip}`
          : 'لم يُحدّد IP جهاز البث بعد',
        cfg.client_subnet
          ? `شبكة العملاء (تلقائي): ${cfg.client_subnet} — كل الأجهزة على هذه الشبكة`
          : '',
        cfg.server_ip
          ? `رابط العملاء: ${viewerUrl}`
          : '',
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
