import { query } from '../db/pool.js';
import { generateSlug } from '../utils/crypto.js';
import { getPublicUrls } from './public-url.service.js';

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
      `SELECT c.*, cat.name as category_name
       FROM channels c
       LEFT JOIN categories cat ON c.category_id = cat.id
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
    `SELECT c.*, cat.name as category_name
     FROM channels c LEFT JOIN categories cat ON c.category_id = cat.id
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

  const { hlsBase } = getPublicUrls();
  const outputUrl = `${hlsBase}/${slug}/index.m3u8`;

  const result = await query(
    `INSERT INTO channels (
       name, slug, description, logo_url, category_id, source_type, source_url,
       backup_source_url, output_format, output_url, transcode_enabled, transcode_profile,
       auto_restart, epg_id, sort_order, is_public
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      data.name, slug, data.description || null, data.logo_url || null,
      data.category_id || null, data.source_type || 'hls', data.source_url,
      data.backup_source_url || null, data.output_format || 'hls', outputUrl,
      data.transcode_enabled || false,
      JSON.stringify(data.transcode_profile || { video_codec: 'copy', audio_codec: 'copy' }),
      data.auto_restart !== false, data.epg_id || null,
      data.sort_order || 0, data.is_public || false,
    ]
  );
  return result.rows[0];
}

export async function updateChannel(id, data) {
  const allowed = [
    'name', 'description', 'logo_url', 'category_id', 'source_type', 'source_url',
    'backup_source_url', 'output_format', 'transcode_enabled', 'transcode_profile',
    'auto_restart', 'epg_id', 'sort_order', 'is_active', 'is_public',
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

  if (sets.length === 0) return getChannelById(id);

  values.push(id);
  const result = await query(
    `UPDATE channels SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function bulkUpdateChannels({ ids, all, updates }) {
  if (!updates || Object.keys(updates).length === 0) {
    throw new Error('No updates provided');
  }

  const allowed = ['category_id', 'is_public', 'auto_restart'];
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

export async function deleteChannel(id) {
  const { cancelChannelJobs } = await import('./queue.service.js');
  await cancelChannelJobs(id);
  await query('DELETE FROM stream_logs WHERE channel_id = $1', [id]);
  await query('DELETE FROM stream_sessions WHERE channel_id = $1', [id]);
  await query('DELETE FROM viewer_sessions WHERE channel_id = $1', [id]);
  await query('DELETE FROM user_channel_access WHERE channel_id = $1', [id]);
  await query('DELETE FROM channels WHERE id = $1', [id]);
}

export async function updateChannelStatus(id, status, extra = {}) {
  const sets = ['status = $2'];
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
    `SELECT * FROM channels WHERE status = 'error' AND auto_restart = true AND is_active = true`
  );
  return result.rows;
}

export function parseM3UContent(content) {
  const lines = content.split(/\r?\n/);
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF:')) continue;

    const nameFromComma = line.match(/,(.*)$/);
    const tvgName = line.match(/tvg-name="([^"]*)"/i)?.[1];
    const groupTitle = line.match(/group-title="([^"]*)"/i)?.[1];
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
      entries.push({ name, url, group: groupTitle || null });
      i = j;
    }
  }

  return entries;
}

function detectSourceType(url) {
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8') || lower.includes('m3u8')) return 'hls';
  if (lower.startsWith('rtmp://') || lower.startsWith('rtmps://')) return 'rtmp';
  if (lower.startsWith('udp://')) return 'udp';
  if (lower.endsWith('.m3u') || lower.includes('/playlist.m3u')) return 'm3u';
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

export async function importM3U(content, { categoryId = null, isPublic = true } = {}) {
  const entries = parseM3UContent(content);
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
        description: entry.group ? `المجموعة: ${entry.group}` : null,
      });
      imported.push({ id: channel.id, name: channel.name, slug: channel.slug });
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
    auto_restart: source.auto_restart,
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
    `SELECT name, slug FROM channels
     WHERE ${conditions.join(' AND ')}
     ORDER BY sort_order, name`
  );
  return result.rows;
}
