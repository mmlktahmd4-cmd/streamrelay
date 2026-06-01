import { query } from '../db/pool.js';
import { createChildLogger } from '../utils/logger.js';
import { refreshPublicUrlCache, getPublicUrls } from './public-url.service.js';
import { buildPublicBaseUrl, readHttpPort } from '../utils/public-url-build.js';

const log = createChildLogger('site-config');

const DEFAULT_SITE = {
  public_domain: '',
  use_https: false,
};

function normalizeDomain(input) {
  let value = String(input || '').trim().toLowerCase();
  if (!value) return '';

  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/\/.*$/, '');
  value = value.replace(/:\d+$/, '');
  return value;
}

export async function getSiteConfig() {
  try {
    const result = await query(`SELECT value FROM settings WHERE key = 'site'`);
    const stored = result.rows[0]?.value || {};
    const urls = getPublicUrls();

    return {
      ...DEFAULT_SITE,
      ...stored,
      public_domain: stored.public_domain || '',
      use_https: !!stored.use_https,
      server_ip: urls.serverIp,
      http_port: urls.webPort,
      active_base_url: urls.baseUrl,
      admin_url: urls.adminUrl,
      viewer_url: urls.viewerUrl,
    };
  } catch {
    const urls = getPublicUrls();
    return {
      ...DEFAULT_SITE,
      server_ip: urls.serverIp,
      http_port: urls.webPort,
      active_base_url: urls.baseUrl,
      admin_url: urls.adminUrl,
      viewer_url: urls.viewerUrl,
    };
  }
}

export async function saveSiteConfig({ public_domain, use_https }) {
  const domain = normalizeDomain(public_domain);
  const https = !!use_https;

  if (domain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
    throw new Error('صيغة الدومين غير صحيحة — مثال: tv.example.com');
  }

  const payload = {
    public_domain: domain,
    use_https: https,
    updated_at: new Date().toISOString(),
  };

  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('site', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(payload)]
  );

  const urls = await refreshPublicUrlCache({ syncUrls: true });

  log.info({ domain, https, baseUrl: urls.baseUrl }, 'Site domain updated');

  return {
    ...payload,
    server_ip: urls.serverIp,
    http_port: urls.webPort,
    active_base_url: urls.baseUrl,
    admin_url: urls.adminUrl,
    viewer_url: urls.viewerUrl,
  };
}

export function buildBaseUrlPreview({ public_domain, use_https, server_ip, http_port }) {
  const host = normalizeDomain(public_domain) || server_ip || '127.0.0.1';
  let port = Number(http_port) || readHttpPort();
  const protocol = use_https ? 'https' : 'http';
  // عند HTTPS ومنفذ HTTP الافتراضي (80) فالرابط الآمن يستخدم 443 — لا نُلحق ":80" الخاطئ.
  if (use_https && port === 80) port = 443;
  return buildPublicBaseUrl(host, port, protocol);
}
