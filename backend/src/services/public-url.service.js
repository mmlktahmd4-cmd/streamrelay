import os from 'os';
import path from 'path';
import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('public-url');

let cache = null;

function detectLanIp() {
  const entries = [];
  for (const [name, interfaces] of Object.entries(os.networkInterfaces())) {
    for (const net of interfaces || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      entries.push({ address: net.address, name });
    }
  }
  if (entries.length === 0) return '127.0.0.1';

  const isPrivate = (ip) =>
    ip.startsWith('192.168.')
    || ip.startsWith('10.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

  const score = (entry) => {
    let s = 0;
    const ip = entry.address;
    if (ip.startsWith('192.168.')) s += 100;
    else if (ip.startsWith('10.')) s += 10;
    const lower = entry.name.toLowerCase();
    if (lower.includes('wi-fi') || lower.includes('wifi') || lower.includes('wireless')) s += 20;
    if (lower.includes('ethernet') && !lower.includes('2')) s += 15;
    if (lower.includes('vpn') || lower.includes('tap') || lower.includes('tun')) s -= 50;
    return s;
  };

  const candidates = entries
    .filter((e) => isPrivate(e.address))
    .sort((a, b) => score(b) - score(a));

  return candidates[0]?.address || entries[0].address;
}

function isLocalIp(ip) {
  const target = String(ip || '').trim();
  if (!target) return false;
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const net of interfaces || []) {
      if (net.family === 'IPv4' && net.address === target) return true;
    }
  }
  return false;
}

function parsePortFromEnvUrl(envValue, fallback) {
  const configured = envValue?.trim();
  if (configured && !configured.includes('localhost') && !configured.includes('127.0.0.1')) {
    try {
      const u = new URL(configured);
      if (u.port) return parseInt(u.port, 10);
      return u.protocol === 'https:' ? 443 : fallback;
    } catch { /* ignore */ }
  }
  const portMatch = configured?.match(/:(\d+)/);
  return portMatch ? parseInt(portMatch[1], 10) : fallback;
}

async function loadMikrotikSettings() {
  try {
    const result = await query(`SELECT value FROM settings WHERE key = 'mikrotik'`);
    return result.rows[0]?.value || {};
  } catch {
    return {};
  }
}

function buildCache(mikrotik) {
  const detectedIp = detectLanIp();
  const configuredIp = mikrotik.server_ip?.trim();
  let serverIp = configuredIp || detectedIp;
  let source = configuredIp ? 'mikrotik' : 'auto';

  if (configuredIp && !isLocalIp(configuredIp)) {
    log.warn({ configuredIp, detectedIp }, 'MikroTik IP not on this device — using laptop IP');
    serverIp = detectedIp;
    source = 'auto';
  }

  const webPort = mikrotik.web_port || parsePortFromEnvUrl(process.env.PUBLIC_BASE_URL, 5173);
  const apiPort = mikrotik.api_port || config.port;
  const baseUrl = `http://${serverIp}:${webPort}`;
  const hlsBase = `${baseUrl}/hls`;

  return {
    serverIp,
    detectedIp,
    webPort,
    apiPort,
    baseUrl,
    hlsBase,
    viewerUrl: `${baseUrl}/watch/login`,
    adminUrl: `${baseUrl}/login`,
    source,
  };
}

export async function refreshPublicUrlCache({ syncUrls = true } = {}) {
  const mikrotik = await loadMikrotikSettings();
  cache = buildCache(mikrotik);

  if (syncUrls) {
    await syncMediaOutputUrls();
  }

  log.info({
    serverIp: cache.serverIp,
    baseUrl: cache.baseUrl,
    source: cache.source,
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
    `http://${urls.serverIp}:5173`,
    `http://${urls.serverIp}:${urls.webPort}`,
    `http://${urls.serverIp}:3000`,
    `http://${urls.detectedIp}:5173`,
    `http://${urls.detectedIp}:3000`,
  ];

  return [...new Set([...fromEnv, ...defaults])];
}

export function isOriginAllowed(origin) {
  if (!origin) return true;
  if (getAllowedOrigins().includes(origin)) return true;

  try {
    const { hostname } = new URL(origin);
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
  const { hlsBase, baseUrl } = getPublicUrls();

  await query(
    `UPDATE channels SET output_url = $1 || slug || '/index.m3u8' WHERE is_active = true`,
    [`${hlsBase}/`]
  );

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
