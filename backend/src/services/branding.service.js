import { query } from '../db/pool.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('branding');

export const DEFAULT_BRANDING = {
  app_title: 'StreamRelay TV',
  app_tagline: 'بث داخلي آمن',
  live_watch_notice: 'أنت تشاهد عبر البث الداخلي على شبكة السيرفر',
  vod_watch_notice: 'تشغيل فيلم من السيرفر المحلي',
  viewer_layout: 'grid',
};

export const VIEWER_LAYOUTS = ['grid', 'posters', 'list', 'rows', 'folders'];

function normalizeLayout(value) {
  const v = String(value ?? '').trim();
  return VIEWER_LAYOUTS.includes(v) ? v : DEFAULT_BRANDING.viewer_layout;
}

const FIELD_LIMITS = {
  app_title: 80,
  app_tagline: 120,
  live_watch_notice: 200,
  vod_watch_notice: 200,
};

function trimText(value, fallback, maxLen) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text.slice(0, maxLen);
}

async function loadStoredBranding() {
  try {
    const result = await query(`SELECT value FROM settings WHERE key = 'branding'`);
    return result.rows[0]?.value || {};
  } catch {
    return {};
  }
}

export async function getBranding() {
  const stored = await loadStoredBranding();
  return {
    app_title: trimText(stored.app_title, DEFAULT_BRANDING.app_title, FIELD_LIMITS.app_title),
    app_tagline: trimText(stored.app_tagline, DEFAULT_BRANDING.app_tagline, FIELD_LIMITS.app_tagline),
    live_watch_notice: trimText(stored.live_watch_notice, DEFAULT_BRANDING.live_watch_notice, FIELD_LIMITS.live_watch_notice),
    vod_watch_notice: trimText(stored.vod_watch_notice, DEFAULT_BRANDING.vod_watch_notice, FIELD_LIMITS.vod_watch_notice),
    viewer_layout: normalizeLayout(stored.viewer_layout),
  };
}

export async function saveBranding(fields = {}) {
  const current = await loadStoredBranding();
  const payload = {
    ...current,
    app_title: trimText(fields.app_title, DEFAULT_BRANDING.app_title, FIELD_LIMITS.app_title),
    app_tagline: trimText(fields.app_tagline, DEFAULT_BRANDING.app_tagline, FIELD_LIMITS.app_tagline),
    live_watch_notice: trimText(fields.live_watch_notice, DEFAULT_BRANDING.live_watch_notice, FIELD_LIMITS.live_watch_notice),
    vod_watch_notice: trimText(fields.vod_watch_notice, DEFAULT_BRANDING.vod_watch_notice, FIELD_LIMITS.vod_watch_notice),
    viewer_layout: normalizeLayout(fields.viewer_layout),
    updated_at: new Date().toISOString(),
  };

  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('branding', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(payload)]
  );

  log.info({ app_title: payload.app_title }, 'Viewer branding updated');
  return getBranding();
}
