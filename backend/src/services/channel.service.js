import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { generateSlug } from '../utils/crypto.js';
import { getPublicUrls } from './public-url.service.js';
import { getServerById } from './server.service.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('channels');

function normalizeTranscodeProfile(value) {
  if (value == null || value === '') return '{}';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value.trim();
    }
  }
  return JSON.stringify(value);
}

function sourceConfigChanged(before, data) {
  const scalarKeys = ['source_url', 'backup_source_url', 'source_type', 'transcode_enabled', 'abr_mode'];
  for (const key of scalarKeys) {
    if (data[key] === undefined) continue;
    if (key === 'transcode_enabled') {
      if (!!before[key] !== !!data[key]) return true;
      continue;
    }
    if (String(before[key] ?? '') !== String(data[key] ?? '')) return true;
  }
  if (data.transcode_profile !== undefined) {
    if (normalizeTranscodeProfile(before.transcode_profile) !== normalizeTranscodeProfile(data.transcode_profile)) {
      return true;
    }
  }
  return false;
}

async function applySourceConfigChange(before, after) {
  const { purgeLocalHlsCache } = await import('./hls-relay.service.js');
  const { getLocalServer, getServerById } = await import('./server.service.js');
  const { runStreamJob } = await import('./queue.service.js');

  // مسح أي بقايا على اللوحة الرئيسية (cache قديم)
  await purgeLocalHlsCache(after.id, after.slug);

  try {
    const { clearOnDemandSession } = await import('./on-demand.service.js');
    clearOnDemandSession(after.id);
  } catch { /* ignore */ }

  const local = await getLocalServer();
  const onRemote = !!(after.server_id && local && after.server_id !== local.id);
  const assigned = after.server_id ? await getServerById(after.server_id) : null;

  // مسح ملفات البث على سيرفر الـ worker الفعلي (محلي أو بعيد) — انتظر اكتمال المسح قبل إعادة التشغيل
  try {
    await runStreamJob('purge-channel-media', after.id, { sourceRefresh: true }, 60000);
  } catch (err) {
    log.warn({ channelId: after.id, err: err.message }, 'Purge before source change failed');
  }

  const wasLive = ['running', 'starting', 'restarting'].includes(before.status);
  const serverNote = onRemote && assigned?.name ? ` على «${assigned.name}»` : '';
  await logStreamEvent(
    after.id,
    'info',
    wasLive
      ? `تم تغيير المصدر — جاري إعادة تشغيل البث${serverNote}`
      : `تم تغيير المصدر — تم مسح ملفات البث القديمة${serverNote}`
  );

  if (!wasLive) return after;

  try {
    await runStreamJob('restart-channel', after.id, { sourceRefresh: true }, 240000);
  } catch (err) {
    log.warn({ channelId: after.id, err: err.message, onRemote }, 'Restart after source change failed');
    await logStreamEvent(after.id, 'error', `فشل إعادة التشغيل بعد تغيير المصدر: ${err.message}`);
  }

  return getChannelById(after.id);
}

export async function listChannels({ page = 1, limit = 50, status, categoryId, search } = {}) {
  const conditions = ['c.is_active = true'];
  const values = [];
  let idx = 1;

  if (status) {
    conditions.push(`c.status = $${idx++}`);
    values.push(status);
  }
  if (categoryId) {
    conditions.push(`c.category_id = $${idx++}`);
    values.push(categoryId);
  }
  if (search) {
    conditions.push(`(c.name ILIKE $${idx} OR c.slug ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const [channels, count] = await Promise.all([
    query(
      `SELECT c.*, cat.name as category_name,
              s.name as server_name, s.hostname as server_hostname
       FROM channels c
       LEFT JOIN categories cat ON c.category_id = cat.id
       LEFT JOIN servers s ON c.server_id = s.id
       ${where}
       ORDER BY c.sort_order, c.name
       LIMIT $${idx++} OFFSET $${idx}`,
      [...values, limit, offset]
    ),
    query(`SELECT COUNT(*) FROM channels c ${where}`, values),
  ]);

  return {
    channels: channels.rows,
    total: parseInt(count.rows[0].count, 10),
    page,
    limit,
  };
}

export async function getChannelById(id) {
  const result = await query(
    `SELECT c.*, cat.name as category_name,
            s.name as server_name, s.hostname as server_hostname
     FROM channels c
     LEFT JOIN categories cat ON c.category_id = cat.id
     LEFT JOIN servers s ON c.server_id = s.id
     WHERE c.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function getChannelBySlug(slug) {
  const result = await query('SELECT * FROM channels WHERE slug = $1', [slug]);
  return result.rows[0] || null;
}

export async function createChannel(data) {
  let slug = data.slug || generateSlug(data.name);
  const existing = await query('SELECT id, is_active FROM channels WHERE slug = $1', [slug]);

  if (existing.rows.length > 0) {
    if (!existing.rows[0].is_active) {
      await query('DELETE FROM channels WHERE id = $1', [existing.rows[0].id]);
    } else {
      throw new Error(`Channel slug "${slug}" already exists — use a different name`);
    }
  }

  if (data.server_id) {
    const server = await getServerById(data.server_id);
    if (!server?.is_active) {
      throw new Error('السيرفر المحدد غير موجود أو معطّل');
    }
  }

  if (data.source_url) data.source_url = String(data.source_url).trim();
  if (data.backup_source_url) data.backup_source_url = String(data.backup_source_url).trim();

  const { hlsBase } = getPublicUrls();

  const result = await query(
    `INSERT INTO channels (
       name, slug, description, logo_url, category_id, source_type, source_url,
       backup_source_url, output_format, output_url, transcode_enabled, transcode_profile,
       auto_restart, epg_id, sort_order, is_public, server_id, on_demand, abr_mode
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      data.name, slug, data.description || null, data.logo_url || null,
      data.category_id || null, data.source_type || 'hls', data.source_url,
      data.backup_source_url || null, data.output_format || 'hls', null,
      data.transcode_enabled || false,
      JSON.stringify(data.transcode_profile || { video_codec: 'copy', audio_codec: 'copy' }),
      data.auto_restart !== false, data.epg_id || null,
      data.sort_order || 0, data.is_public || false,
      data.server_id || null,
      !!data.on_demand,
      data.abr_mode || 'default',
    ]
  );
  const row = result.rows[0];
  const outputUrl = `${hlsBase}/${row.id}/index.m3u8`;
  await query('UPDATE channels SET output_url = $2 WHERE id = $1', [row.id, outputUrl]);
  return { ...row, output_url: outputUrl };
}

export async function updateChannel(id, data) {
  const before = await getChannelById(id);
  if (!before) return null;

  if (data.source_url !== undefined) data.source_url = String(data.source_url).trim();
  if (data.backup_source_url !== undefined) {
    const trimmed = String(data.backup_source_url).trim();
    data.backup_source_url = trimmed || null;
  }

  const allowed = [
    'name', 'description', 'logo_url', 'category_id', 'source_type', 'source_url',
    'backup_source_url', 'output_format', 'transcode_enabled', 'transcode_profile',
    'auto_restart', 'epg_id', 'sort_order', 'is_active', 'is_public', 'server_id', 'on_demand',
    'abr_mode',
  ];

  const sets = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (data[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      values.push(key === 'transcode_profile' ? JSON.stringify(data[key]) : data[key]);
    }
  }

  if (data.server_id) {
    const server = await getServerById(data.server_id);
    if (!server?.is_active) {
      throw new Error('السيرفر المحدد غير موجود أو معطّل');
    }
  }

  if (sets.length === 0) return getChannelById(id);

  values.push(id);
  const result = await query(
    `UPDATE channels SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  let channel = result.rows[0] || null;
  if (channel && sourceConfigChanged(before, data)) {
    channel = await applySourceConfigChange(before, channel) || channel;
  }
  return channel;
}

export async function bulkUpdateChannels({ ids, all, updates }) {
  if (!updates || Object.keys(updates).length === 0) {
    throw new Error('No updates provided');
  }

  const allowed = ['category_id', 'is_public', 'auto_restart', 'on_demand', 'is_active'];
  const sets = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      values.push(updates[key]);
    }
  }

  if (sets.length === 0) {
    throw new Error('No valid updates provided');
  }

  sets.push('updated_at = NOW()');

  let where = 'is_active = true';
  if (!all) {
    where += ` AND id = ANY($${idx++}::uuid[])`;
    values.push(ids);
  }

  const result = await query(
    `UPDATE channels SET ${sets.join(', ')} WHERE ${where} RETURNING id`,
    values
  );

  return { updated: result.rowCount, ids: result.rows.map((r) => r.id) };
}

export async function bulkStreamAction({ action, ids, all }) {
  let channelRows;

  if (all) {
    const result = await query(
      `SELECT id, name, status FROM channels WHERE is_active = true ORDER BY sort_order, name`
    );
    channelRows = result.rows;
  } else {
    const result = await query(
      `SELECT id, name, status FROM channels WHERE is_active = true AND id = ANY($1::uuid[])`,
      [ids]
    );
    channelRows = result.rows;
  }

  if (channelRows.length === 0) {
    return { queued: 0, action, total: 0 };
  }

  const { getQueue } = await import('./queue.service.js');
  const queue = getQueue();
  const jobName = action === 'start'
    ? 'start-channel'
    : action === 'stop'
      ? 'stop-channel'
      : 'restart-channel';

  const { buildStreamJobPayload } = await import('./server.service.js');
  const { kickOnDemandStream } = await import('./on-demand.service.js');
  let queued = 0;
  for (let i = 0; i < channelRows.length; i += 1) {
    const channel = channelRows[i];
    const full = await getChannelById(channel.id);
    if (!full) continue;

    // On Demand: تشغيل/إعادة تشغيل عبر kickOnDemand وليس قائمة الانتظار العادية
    if (full.on_demand && action === 'start') {
      await kickOnDemandStream(channel.id);
      queued += 1;
      continue;
    }
    if (full.on_demand && action === 'restart') {
      const stopPayload = await buildStreamJobPayload(channel.id, 'stop');
      await queue.add('stop-channel', { ...stopPayload, options: { manual: true } }, {
        delay: i * config.streaming.bulkStartStaggerMs,
        jobId: `restart-stop-${channel.id}-${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: 50,
      });
      await kickOnDemandStream(channel.id);
      queued += 1;
      continue;
    }

    const actionType = action === 'stop' ? 'stop' : action === 'restart' ? 'restart' : 'start';
    const payload = await buildStreamJobPayload(channel.id, actionType);
    const data = action === 'stop'
      ? { ...payload, options: { manual: true } }
      : payload;

    await queue.add(jobName, data, {
      delay: i * config.streaming.bulkStartStaggerMs,
      jobId: `${jobName}-${channel.id}`,
      removeOnComplete: true,
      removeOnFail: 50,
    });
    queued += 1;
  }

  return { queued, action, total: channelRows.length };
}

export async function stopChannelForDelete(id) {
  const { runStreamJob } = await import('./queue.service.js');
  try {
    await runStreamJob('stop-channel', id, { options: { forDelete: true, manual: true } }, 90000);
  } catch {
    /* قد تكون متوقفة مسبقاً أو worker غير متاح */
  }
}

export async function deleteChannel(id) {
  const channel = await getChannelById(id);
  if (!channel) return;

  const { cancelChannelJobs } = await import('./queue.service.js');
  await cancelChannelJobs(id);

  try {
    const { clearOnDemandSession } = await import('./on-demand.service.js');
    clearOnDemandSession(id);
  } catch { /* ignore */ }

  const { releaseChannelFromServer } = await import('./server.service.js');
  await releaseChannelFromServer(id);

  await query('DELETE FROM stream_logs WHERE channel_id = $1', [id]);
  await query('DELETE FROM stream_sessions WHERE channel_id = $1', [id]);
  await query('DELETE FROM viewer_sessions WHERE channel_id = $1', [id]);
  await query('DELETE FROM user_channel_access WHERE channel_id = $1', [id]);
  await query('DELETE FROM channels WHERE id = $1', [id]);
}

export async function bulkDeleteChannels({ ids, all }) {
  let channelRows = [];
  let movieRows = [];

  if (all) {
    const result = await query(
      `SELECT id, name FROM channels WHERE is_active = true ORDER BY sort_order, name`
    );
    channelRows = result.rows;
  } else if (ids?.length) {
    const [chResult, mvResult] = await Promise.all([
      query(
        `SELECT id, name FROM channels WHERE is_active = true AND id = ANY($1::uuid[])`,
        [ids]
      ),
      query(
        `SELECT id, name FROM movies WHERE is_active = true AND id = ANY($1::uuid[])`,
        [ids]
      ),
    ]);
    channelRows = chResult.rows;
    movieRows = mvResult.rows;
  }

  if (channelRows.length === 0 && movieRows.length === 0) {
    return { deleted: 0, total: 0, failed: [], channels_deleted: 0, movies_deleted: 0 };
  }

  let deleted = 0;
  let channelsDeleted = 0;
  let moviesDeleted = 0;
  const failed = [];

  for (const row of channelRows) {
    try {
      await stopChannelForDelete(row.id);
      await deleteChannel(row.id);
      deleted += 1;
      channelsDeleted += 1;
    } catch (err) {
      failed.push({ id: row.id, name: row.name, error: err.message, type: 'channel' });
    }
  }

  if (movieRows.length > 0) {
    const { deleteMovie } = await import('./category.service.js');
    for (const row of movieRows) {
      try {
        await deleteMovie(row.id);
        deleted += 1;
        moviesDeleted += 1;
      } catch (err) {
        failed.push({ id: row.id, name: row.name, error: err.message, type: 'movie' });
      }
    }
  }

  return {
    deleted,
    total: channelRows.length + movieRows.length,
    failed,
    channels_deleted: channelsDeleted,
    movies_deleted: moviesDeleted,
  };
}

export async function updateChannelStatus(id, status, extra = {}) {
  const sets = ['status = $2', 'updated_at = NOW()'];
  const values = [id, status];
  let idx = 3;

  for (const [key, value] of Object.entries(extra)) {
    sets.push(`${key} = $${idx++}`);
    values.push(value);
  }

  await query(`UPDATE channels SET ${sets.join(', ')} WHERE id = $1`, values);
}

export async function getRunningChannels() {
  const result = await query(
    `SELECT * FROM channels WHERE status IN ('running', 'starting', 'restarting') AND is_active = true`
  );
  return result.rows;
}

export async function getErrorChannelsWithAutoRestart() {
  const result = await query(
    `SELECT * FROM channels WHERE status = 'error' AND auto_restart = true AND on_demand = false AND is_active = true`
  );
  return result.rows;
}

/** قنوات متوقفة مع إعادة تشغيل تلقائي */
export async function getStoppedChannelsWithAutoRestart() {
  const result = await query(
    `SELECT * FROM channels
     WHERE is_active = true AND auto_restart = true AND on_demand = false AND status = 'stopped'`
  );
  return result.rows;
}

/** قنوات يجب تشغيلها تلقائياً (بعد إقلاع السيرفر أو عند التوقف) */
export async function getChannelsForAutoStart() {
  const result = await query(
    `SELECT * FROM channels
     WHERE is_active = true
       AND auto_restart = true
       AND on_demand = false
       AND status IN ('stopped', 'error', 'running', 'starting', 'restarting')`
  );
  return result.rows;
}

function readM3uMaxBytes() {
  const mb = parseInt(process.env.M3U_IMPORT_MAX_MB || '100', 10);
  const safeMb = Number.isFinite(mb) && mb >= 1 ? Math.min(mb, 250) : 100;
  return safeMb * 1024 * 1024;
}

function readM3uFetchTimeoutMs() {
  const ms = parseInt(process.env.M3U_IMPORT_TIMEOUT_MS || '180000', 10);
  return Number.isFinite(ms) && ms >= 30000 ? ms : 180000;
}

async function readResponseBodyLimited(res, maxBytes) {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      const gotMb = (buf.length / 1024 / 1024).toFixed(1);
      const maxMb = (maxBytes / 1024 / 1024).toFixed(0);
      throw new Error(`ملف القنوات كبير جداً (${gotMb}MB — الحد ${maxMb}MB)`);
    }
    return buf;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        const maxMb = (maxBytes / 1024 / 1024).toFixed(0);
        throw new Error(`ملف القنوات كبير جداً (يتجاوز ${maxMb}MB)`);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err.message?.includes('ملف القنوات')) throw err;
    throw new Error('انقطع التحميل أثناء تنزيل قائمة القنوات');
  }

  return Buffer.concat(chunks);
}

function parseExtinfAttr(line, attr) {
  const re = new RegExp(`${attr}="([^"]*)"`, 'i');
  return line.match(re)?.[1]?.trim() || null;
}

export function parseM3UContent(content) {
  const lines = content.split(/\r?\n/);
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF:')) continue;

    const nameFromComma = line.match(/,(.*)$/);
    const tvgName = parseExtinfAttr(line, 'tvg-name');
    const groupTitle = parseExtinfAttr(line, 'group-title');
    const tvgLogo = parseExtinfAttr(line, 'tvg-logo');
    const tvgId = parseExtinfAttr(line, 'tvg-id');
    let name = (nameFromComma?.[1] || tvgName || '').trim();
    if (!name) name = `Channel ${entries.length + 1}`;

    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j].trim();
      if (next && !next.startsWith('#')) break;
      j++;
    }
    const url = lines[j]?.trim();
    if (url && !url.startsWith('#')) {
      entries.push({
        name,
        url,
        group: groupTitle || null,
        logo_url: tvgLogo || null,
        epg_id: tvgId || null,
      });
      i = j;
    }
  }

  return entries;
}

export function validateM3uFetchUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || '').trim());
  } catch {
    throw new Error('رابط غير صالح');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('الرابط يجب أن يبدأ بـ http أو https');
  }
  return parsed.toString();
}

export async function fetchM3UFromUrl(rawUrl) {
  const url = validateM3uFetchUrl(rawUrl);
  const maxBytes = readM3uMaxBytes();
  const timeoutMs = readM3uFetchTimeoutMs();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'StreamRelay/1.0 M3U-Importer',
      Accept: 'application/x-mpegURL, audio/x-mpegurl, text/plain, */*',
    },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`فشل تنزيل القائمة (HTTP ${res.status})`);
  }

  const buf = await readResponseBodyLimited(res, maxBytes);
  const text = buf.toString('utf8');
  if (!text.includes('#EXTM3U') && !text.includes('#EXTINF:')) {
    throw new Error('الرابط لا يحتوي على قائمة M3U صالحة');
  }

  return text;
}

export async function previewM3UFromUrl(rawUrl) {
  const content = await fetchM3UFromUrl(rawUrl);
  const entries = parseM3UContent(content);
  const groups = [...new Set(entries.map((e) => e.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));

  return {
    url: validateM3uFetchUrl(rawUrl),
    total: entries.length,
    groups,
    channels: entries.map((entry, index) => ({
      id: index,
      name: entry.name,
      url: entry.url,
      group: entry.group,
      logo_url: entry.logo_url,
      epg_id: entry.epg_id,
      source_type: detectSourceType(entry.url),
    })),
  };
}

function detectSourceType(url) {
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8') || lower.includes('m3u8')) return 'hls';
  if (lower.startsWith('rtmp://') || lower.startsWith('rtmps://')) return 'rtmp';
  if (lower.startsWith('udp://')) return 'udp';
  if (lower.endsWith('.ts') || lower.includes('output=mpegts')) return 'http';
  if (lower.endsWith('.m3u') || lower.includes('/playlist.m3u')) return 'm3u';
  // روابط Xtream Codes: http(s)://host:port/username/password/stream_id (بدون امتداد)
  // تُعامل كـ http؛ والإدخال يتبع إعادة التوجيه ويسمح بكل الامتدادات تلقائياً.
  if (/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/\d+\/?$/.test(lower)) return 'http';
  return 'http';
}

async function createChannelUniqueName(baseData, attempt = 0) {
  const suffix = attempt === 0 ? '' : ` ${attempt + 1}`;
  const name = `${baseData.name}${suffix}`;
  try {
    return await createChannel({ ...baseData, name });
  } catch (err) {
    if (err.message?.includes('already exists') && attempt < 20) {
      return createChannelUniqueName(baseData, attempt + 1);
    }
    throw err;
  }
}

async function generateUniqueCopySlug(sourceSlug) {
  const base = `${sourceSlug}-copy`;
  const candidates = [base, ...Array.from({ length: 50 }, (_, i) => `${base}-${i + 2}`)];

  for (const slug of candidates) {
    const existing = await query(
      'SELECT id FROM channels WHERE slug = $1 AND is_active = true',
      [slug]
    );
    if (existing.rows.length === 0) return slug;
  }

  return `${base}-${Date.now()}`;
}

function parseTranscodeProfile(value) {
  if (!value) return { video_codec: 'copy', audio_codec: 'copy' };
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return { video_codec: 'copy', audio_codec: 'copy' };
  }
}

export async function importM3UEntries(entries, { categoryId = null, isPublic = true, onDemand = false } = {}) {
  const imported = [];
  const skipped = [];
  const errors = [];

  for (const entry of entries) {
    try {
      const channel = await createChannelUniqueName({
        name: entry.name,
        source_type: detectSourceType(entry.url),
        source_url: entry.url,
        category_id: categoryId,
        is_public: isPublic,
        on_demand: onDemand,
        logo_url: entry.logo_url || null,
        epg_id: entry.epg_id || null,
        description: entry.group ? `المجموعة: ${entry.group}` : null,
      });
      imported.push({ id: channel.id, name: channel.name, slug: channel.slug });

      if (channel.auto_restart !== false && !channel.on_demand) {
        const { scheduleAutoStart } = await import('./stream.service.js');
        await scheduleAutoStart(channel.id, { delay: 5000 + imported.length * 400 });
      }
    } catch (err) {
      if (err.message?.includes('already exists')) {
        skipped.push({ name: entry.name, reason: 'duplicate' });
      } else {
        errors.push({ name: entry.name, error: err.message });
      }
    }
  }

  return { imported, skipped, errors, total_parsed: entries.length };
}

export async function importM3U(content, { categoryId = null, isPublic = true, onDemand = false } = {}) {
  return importM3UEntries(parseM3UContent(content), { categoryId, isPublic, onDemand });
}

export async function importM3USelected(channels, { categoryId = null, isPublic = true, onDemand = false } = {}) {
  const entries = (channels || []).map((ch) => ({
    name: ch.name,
    url: ch.url,
    group: ch.group || null,
    logo_url: ch.logo_url || null,
    epg_id: ch.epg_id || null,
  }));
  return importM3UEntries(entries, { categoryId, isPublic, onDemand });
}

export async function duplicateChannel(id) {
  const source = await getChannelById(id);
  if (!source) throw new Error('Channel not found');

  const slug = await generateUniqueCopySlug(source.slug);

  return createChannelUniqueName({
    name: `${source.name} (نسخة)`,
    slug,
    source_type: source.source_type,
    source_url: source.source_url,
    backup_source_url: source.backup_source_url,
    output_format: source.output_format,
    category_id: source.category_id,
    description: source.description,
    transcode_enabled: source.transcode_enabled,
    transcode_profile: parseTranscodeProfile(source.transcode_profile),
    abr_mode: source.abr_mode || 'default',
    auto_restart: source.auto_restart,
    on_demand: source.on_demand,
    is_public: source.is_public,
    logo_url: source.logo_url,
  });
}

export async function logStreamEvent(channelId, level, message, metadata = {}) {
  try {
    await query(
      `INSERT INTO stream_logs (channel_id, level, message, metadata) VALUES ($1, $2, $3, $4)`,
      [channelId, level, message, JSON.stringify(metadata)]
    );
  } catch (err) {
    // Channel may have been deleted while a restart/health job was pending
    if (err.code === '23503') return;
    throw err;
  }
}

export async function getStreamLogs({ channelId, level, page = 1, limit = 50 } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (channelId) {
    conditions.push(`channel_id = $${idx++}`);
    values.push(channelId);
  }
  if (level) {
    conditions.push(`level = $${idx++}`);
    values.push(level);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const result = await query(
    `SELECT sl.*, c.name as channel_name
     FROM stream_logs sl LEFT JOIN channels c ON sl.channel_id = c.id
     ${where} ORDER BY sl.created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
    [...values, limit, offset]
  );
  return result.rows;
}

export async function listCategories() {
  const result = await query('SELECT * FROM categories ORDER BY sort_order, name');
  return result.rows;
}

export async function createCategory(name) {
  const slug = generateSlug(name);
  const result = await query(
    'INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING *',
    [name, slug]
  );
  return result.rows[0];
}

export function sanitizeChannelForRole(channel, role) {
  if (!channel) return channel;
  if (role === 'viewer') {
    const { source_url, backup_source_url, pid, ...safe } = channel;
    return safe;
  }
  return channel;
}

export async function listRunningChannelsForPlaylist({ publicOnly = false } = {}) {
  const conditions = ["is_active = true", "status = 'running'"];
  if (publicOnly) conditions.push('is_public = true');

  const result = await query(
    `SELECT id, name, slug, server_id, output_url FROM channels
     WHERE ${conditions.join(' AND ')}
     ORDER BY sort_order, name`
  );
  return result.rows;
}
