import path from 'path';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { getServerByHostname, getServerById, getInternalHlsBaseForServer } from './server.service.js';
import {
  detectPhysicalLanIp,
  ipInSubnet,
  isDockerBridgeIp,
  isRunningInContainer,
  resolveHomeSubnet,
} from '../utils/network-ip.js';
import {
  buildPublicBaseUrl,
  normalizeConfiguredBaseUrl,
} from '../utils/public-url-build.js';

const log = createChildLogger('public-url');

let cache = null;
let lastWatchedIp = null;
let watchTimer = null;

function parseEnvPublicBase() {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (!configured || configured.includes('localhost') || configured.includes('127.0.0.1')) {
    return null;
  }

  try {
    const url = new URL(configured);
    const defaultPort = url.protocol === 'https:' ? 443 : 80;
    const explicitPort = url.port ? parseInt(url.port, 10) : null;
    const envHttpPort = parseInt(process.env.STREAMRELAY_HTTP_PORT || '', 10);
    const port = explicitPort
      || (Number.isFinite(envHttpPort) && envHttpPort > 0 ? envHttpPort : defaultPort);

    return {
      hostname: url.hostname,
      port,
      protocol: url.protocol.replace(':', ''),
    };
  } catch {
    return null;
  }
}

function getHomeSubnet(mikrotik) {
  const publicBase = parseEnvPublicBase();
  return resolveHomeSubnet({
    envSubnet: process.env.SERVER_LAN_SUBNET,
    serverIp: process.env.SERVER_IP,
    publicHostname: publicBase?.hostname,
    mikrotikSubnet: mikrotik.client_subnet,
    mikrotikServerIp: mikrotik.server_ip,
  });
}

function acceptConfiguredIp(ip) {
  const value = String(ip || '').trim();
  if (!value) return null;
  if (isDockerBridgeIp(value)) return null;
  return value;
}

function acceptPinnedIp(ip, homeSubnet) {
  const value = acceptConfiguredIp(ip);
  if (!value) return null;
  if (homeSubnet && !ipInSubnet(value, homeSubnet)) return null;
  return value;
}

function readEnvServerIp() {
  const direct = process.env.SERVER_IP?.trim();
  if (direct) return direct;

  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (!configured || configured.includes('localhost') || configured.includes('127.0.0.1')) {
    return null;
  }

  try {
    return new URL(configured).hostname;
  } catch {
    return null;
  }
}

function resolveServerIp(mikrotik, serverNetwork = {}) {
  const homeSubnet = getHomeSubnet(mikrotik);
  const publicBase = parseEnvPublicBase();
  const envServerIp = process.env.SERVER_IP?.trim();
  const publicHostname = publicBase?.hostname;

  // وضع DHCP: تجاهل أي IP مثبّت سابقاً — اعتمد على .env المكتشف
  if (serverNetwork.mode !== 'dhcp') {
    const panelIp = acceptConfiguredIp(serverNetwork.pinned_ip);
    if (panelIp) return { ip: panelIp, source: 'panel', homeSubnet };
  }

  // PUBLIC_BASE_URL يختلف عن SERVER_IP — المستخدم حدّث الرابط يدوياً
  if (publicHostname && envServerIp && publicHostname !== envServerIp) {
    const preferred = acceptConfiguredIp(publicHostname);
    if (preferred) return { ip: preferred, source: 'public_base_url', homeSubnet };
  }

  const envIp = acceptConfiguredIp(envServerIp);
  if (envIp) return { ip: envIp, source: 'env', homeSubnet };

  const publicIp = acceptConfiguredIp(publicHostname);
  if (publicIp) return { ip: publicIp, source: 'public_base_url', homeSubnet };

  const mikrotikIp = acceptPinnedIp(mikrotik.server_ip, homeSubnet);
  if (mikrotikIp) return { ip: mikrotikIp, source: 'mikrotik', homeSubnet };

  // داخل Docker لا يوجد IP LAN حقيقي — لا نستخدم 172.18.x أبداً
  if (isRunningInContainer()) {
    const forced = acceptConfiguredIp(readEnvServerIp());
    if (forced) return { ip: forced, source: 'env', homeSubnet };

    log.error('SERVER_IP or PUBLIC_BASE_URL must be set — Docker cannot auto-detect LAN IP');
    return { ip: '127.0.0.1', source: 'env', homeSubnet };
  }

  return {
    ip: detectPhysicalLanIp(homeSubnet),
    source: 'auto',
    homeSubnet,
  };
}

function resolveWebPort(mikrotik) {
  const publicBase = parseEnvPublicBase();
  if (publicBase?.port) return publicBase.port;

  const envHttpPort = parseInt(process.env.STREAMRELAY_HTTP_PORT || '', 10);
  if (Number.isFinite(envHttpPort) && envHttpPort > 0) return envHttpPort;

  if (mikrotik.web_port) return mikrotik.web_port;

  return 5173;
}

async function loadMikrotikSettings() {
  try {
    const result = await query(`SELECT value FROM settings WHERE key = 'mikrotik'`);
    return result.rows[0]?.value || {};
  } catch {
    return {};
  }
}

async function loadSiteSettings() {
  try {
    const result = await query(`SELECT value FROM settings WHERE key = 'site'`);
    return result.rows[0]?.value || {};
  } catch {
    return {};
  }
}

async function loadServerNetworkSettings() {
  try {
    const result = await query(`SELECT value FROM settings WHERE key = 'server_network'`);
    return result.rows[0]?.value || {};
  } catch {
    return {};
  }
}

function normalizePublicDomain(input) {
  let value = String(input || '').trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/\/.*$/, '');
  value = value.replace(/:\d+$/, '');
  return value;
}

function buildCache(mikrotik, site = {}, serverNetwork = {}) {
  const homeSubnet = getHomeSubnet(mikrotik);
  const detectedIp = detectPhysicalLanIp(homeSubnet);
  const { ip: serverIp, source } = resolveServerIp(mikrotik, serverNetwork);
  const webPort = resolveWebPort(mikrotik);
  const apiPort = mikrotik.api_port || config.port;
  const publicDomain = normalizePublicDomain(site.public_domain);
  const useHttps = !!site.use_https;
  const protocol = useHttps ? 'https' : 'http';
  // عند HTTPS ومنفذ HTTP الافتراضي (80) فالرابط الآمن يستخدم المنفذ 443 (الافتراضي) — لا نُلحق ":80" الخاطئ.
  const domainPort = useHttps && webPort === 80 ? 443 : webPort;
  const baseUrl = publicDomain
    ? buildPublicBaseUrl(publicDomain, domainPort, protocol)
    : normalizeConfiguredBaseUrl(process.env.PUBLIC_BASE_URL, serverIp, webPort);
  const hlsBase = `${baseUrl}/api/hls`;

  return {
    serverIp,
    detectedIp,
    homeSubnet,
    webPort,
    apiPort,
    publicDomain,
    useHttps,
    baseUrl,
    hlsBase,
    viewerUrl: `${baseUrl}/watch/login`,
    adminUrl: `${baseUrl}/login`,
    source,
  };
}

export async function refreshPublicUrlCache({ syncUrls = true } = {}) {
  const mikrotik = await loadMikrotikSettings();
  const site = await loadSiteSettings();
  const serverNetwork = await loadServerNetworkSettings();
  const previousIp = cache?.serverIp;
  cache = buildCache(mikrotik, site, serverNetwork);
  lastWatchedIp = cache.serverIp;

  if (syncUrls) {
    await syncMediaOutputUrls();
    try {
      const { syncEnvPublicLinks } = await import('../utils/env-file.js');
      syncEnvPublicLinks(cache.baseUrl, { serverIp: cache.serverIp, httpPort: cache.webPort });
    } catch (err) {
      log.warn({ err: err.message }, 'Failed to sync .env public URLs');
    }
  }

  // توحيد إعداد الميكروتك مع IP السيرفر الفعلي (يغطّي حالة DHCP بعد اكتشاف العنوان الجديد)
  if (serverNetwork.mode && cache.serverIp && cache.serverIp !== '127.0.0.1'
      && mikrotik.server_ip !== cache.serverIp) {
    try {
      const { setMikrotikServerIp } = await import('./mikrotik.service.js');
      await setMikrotikServerIp(cache.serverIp);
    } catch (err) {
      log.warn({ err: err.message }, 'Failed to sync MikroTik IP during refresh');
    }
  }

  log.info({
    serverIp: cache.serverIp,
    detectedIp: cache.detectedIp,
    homeSubnet: cache.homeSubnet,
    baseUrl: cache.baseUrl,
    source: cache.source,
    changed: previousIp && previousIp !== cache.serverIp,
  }, 'Public URLs updated');

  return cache;
}

export function getPublicUrls() {
  if (cache) return cache;

  const mikrotik = {};
  cache = buildCache(mikrotik);
  return cache;
}

export function getAllowedOrigins() {
  const urls = getPublicUrls();
  const fromEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const defaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    urls.baseUrl,
    buildPublicBaseUrl(urls.serverIp, urls.webPort),
    `http://${urls.serverIp}:5173`,
    `http://${urls.serverIp}:3000`,
    `http://${urls.detectedIp}:5173`,
    `http://${urls.detectedIp}:3000`,
  ];

  if (urls.publicDomain) {
    defaults.push(buildPublicBaseUrl(urls.publicDomain, urls.webPort, urls.useHttps ? 'https' : 'http'));
    defaults.push(`http://${urls.publicDomain}`);
    if (urls.useHttps) {
      defaults.push(`https://${urls.publicDomain}`);
    }
  }

  return [...new Set([...fromEnv, ...defaults])];
}

export function isOriginAllowed(origin) {
  if (!origin) return true;
  if (getAllowedOrigins().includes(origin)) return true;

  try {
    const { hostname } = new URL(origin);
    const urls = getPublicUrls();
    if (urls.publicDomain && (hostname === urls.publicDomain || hostname === `www.${urls.publicDomain}`)) {
      return true;
    }
    if (config.env === 'development') {
      return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname.startsWith('192.168.')
        || hostname.startsWith('10.')
        || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
        || hostname === getPublicUrls().serverIp;
    }
  } catch { /* ignore */ }

  return false;
}

export async function syncMediaOutputUrls() {
  const { hlsBase, baseUrl, publicDomain } = getPublicUrls();
  const local = await getServerByHostname(config.serverId);

  if (publicDomain) {
    // مع دومين — كل القنوات (محلية وبعيدة) تُعرَض عبر اللوحة الرئيسية
    await query(
      `UPDATE channels SET output_url = $1 || id::text || '/index.m3u8'
       WHERE is_active = true`,
      [`${hlsBase}/`]
    );
  } else if (local?.id) {
    // بدون دومين — المحلي فقط؛ البعيد يبقى على IP سيرفره
    await query(
      `UPDATE channels SET output_url = $1 || id::text || '/index.m3u8'
       WHERE is_active = true AND (server_id IS NULL OR server_id = $2)`,
      [`${hlsBase}/`, local.id]
    );
    const remoteRows = await query(
      `SELECT id, server_id FROM channels
       WHERE is_active = true AND server_id IS NOT NULL AND server_id != $1`,
      [local.id]
    );
    for (const row of remoteRows.rows) {
      const server = await getServerById(row.server_id);
      if (!server) continue;
      const internalBase = getInternalHlsBaseForServer(server).replace(/\/$/, '');
      await query(
        'UPDATE channels SET output_url = $1 WHERE id = $2',
        [`${internalBase}/${row.id}/index.m3u8`, row.id]
      );
    }
  } else {
    await query(
      `UPDATE channels SET output_url = $1 || id::text || '/index.m3u8'
       WHERE is_active = true AND server_id IS NULL`,
      [`${hlsBase}/`]
    );
  }

  try {
    const movies = await query(`SELECT id, slug, file_path FROM movies WHERE is_active = true`);
    for (const m of movies.rows) {
      const ext = path.extname(m.file_path || '') || '.mp4';
      await query(
        `UPDATE movies SET output_url = $1 WHERE id = $2`,
        [`${baseUrl}/vod/${m.slug}${ext}`, m.id]
      );
    }
  } catch {
    // movies table may not exist
  }

  log.info({ hlsBase, baseUrl }, 'Synced channel/movie output URLs');
}

async function watchNetworkChange() {
  const urls = getPublicUrls();
  const mikrotik = await loadMikrotikSettings();
  const site = await loadSiteSettings();
  const serverNetwork = await loadServerNetworkSettings();
  const next = buildCache(mikrotik, site, serverNetwork);

  if (next.serverIp === urls.serverIp
      && next.baseUrl === urls.baseUrl
      && next.publicDomain === urls.publicDomain
      && next.useHttps === urls.useHttps) {
    lastWatchedIp = next.serverIp;
    return;
  }

  log.info({
    from: urls.serverIp,
    to: next.serverIp,
    homeSubnet: next.homeSubnet,
  }, 'LAN IP changed — refreshing channel URLs');

  lastWatchedIp = next.serverIp;
  await refreshPublicUrlCache({ syncUrls: true });
}

export function startNetworkWatcher() {
  if (watchTimer) return;

  const intervalMs = parseInt(process.env.NETWORK_WATCH_INTERVAL_MS || '30000', 10);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;

  watchTimer = setInterval(() => {
    watchNetworkChange().catch((err) => {
      log.warn({ err: err.message }, 'Network watch tick failed');
    });
  }, intervalMs);
  watchTimer.unref();

  log.info({ intervalMs }, 'Network watcher started');
}
