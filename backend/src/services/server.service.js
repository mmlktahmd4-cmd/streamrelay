import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { getHostMetricsSnapshot } from '../utils/metrics.js';
import { getPublicUrls } from './public-url.service.js';

const log = createChildLogger('servers');

export const HEARTBEAT_ONLINE_MS = 90_000;

export function canRunStreams(role) {
  return role === 'full' || role === 'stream-only';
}

function normalizeMetadata(input = {}) {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  const meta = typeof raw === 'object' && raw ? { ...raw } : {};
  if (meta.hls_base_url) meta.hls_base_url = String(meta.hls_base_url).trim().replace(/\/$/, '');
  if (meta.public_base_url) meta.public_base_url = String(meta.public_base_url).trim().replace(/\/$/, '');
  return meta;
}

function attachLiveStats(server) {
  if (!server) return server;
  const snapshot = getHostMetricsSnapshot();
  return {
    ...server,
    host_stats: snapshot,
    cpu_percent: snapshot.cpu?.usage_percent ?? null,
    memory_percent: snapshot.memory?.usage_percent ?? null,
    disk_percent: snapshot.disk?.usage_percent ?? null,
  };
}

export function isServerOnline(server, now = Date.now()) {
  if (!server?.is_active) return false;
  if (!server.last_heartbeat) return server.hostname === config.serverId;
  const ts = new Date(server.last_heartbeat).getTime();
  return Number.isFinite(ts) && (now - ts) <= HEARTBEAT_ONLINE_MS;
}

export function getServerLoadPercent(server) {
  const max = Number(server?.max_streams) || 1;
  const current = Number(server?.current_streams) || 0;
  return Math.min(100, Math.round((current / max) * 100));
}

function sanitizeMetadataForClient(metadata = {}) {
  const meta = { ...metadata };
  const configured = !!(meta.ssh_username && meta.ssh_password);
  delete meta.ssh_password;
  return { ...meta, ssh_configured: configured };
}

function decorateServer(row) {
  if (!row) return null;
  const metadata = sanitizeMetadataForClient(normalizeMetadata(row.metadata));
  const hostStats = metadata.host_stats && typeof metadata.host_stats === 'object'
    ? metadata.host_stats
    : null;

  return {
    ...row,
    metadata,
    online: isServerOnline(row),
    is_suspended: !!metadata.suspended,
    load_percent: getServerLoadPercent(row),
    is_local: row.hostname === config.serverId,
    hls_base_url: metadata.hls_base_url || null,
    public_base_url: metadata.public_base_url || null,
    host_stats: hostStats,
    cpu_percent: hostStats?.cpu?.usage_percent ?? null,
    memory_percent: hostStats?.memory?.usage_percent ?? null,
    disk_percent: hostStats?.disk?.usage_percent ?? null,
  };
}

export async function getServerById(id) {
  const result = await query('SELECT * FROM servers WHERE id = $1', [id]);
  return decorateServer(result.rows[0] || null);
}

export async function getServerMetadataRaw(id) {
  const result = await query('SELECT metadata FROM servers WHERE id = $1', [id]);
  if (!result.rows[0]) return null;
  return normalizeMetadata(result.rows[0]?.metadata);
}

export async function patchServerMetadata(id, patch) {
  const existing = await getServerMetadataRaw(id);
  if (existing === null) throw new Error('السيرفر غير موجود');
  const metadata = normalizeMetadata({ ...existing });
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) delete metadata[key];
    else metadata[key] = value;
  }
  await query(
    `UPDATE servers SET metadata = $2 WHERE id = $1`,
    [id, JSON.stringify(metadata)]
  );
  return getServerById(id);
}

export async function getServerByHostname(hostname) {
  const result = await query('SELECT * FROM servers WHERE hostname = $1', [hostname]);
  return decorateServer(result.rows[0] || null);
}

export async function getLocalServer() {
  return getServerByHostname(config.serverId);
}

/** هل هذه القناة مربوطة بتشغيل FFmpeg على هذا السيرفر (worker الحالي)؟ */
export async function isChannelAssignedToLocalWorker(channel) {
  if (!channel) return false;
  const local = await getLocalServer();
  if (!local) return true;
  if (!channel.server_id) return true;
  return channel.server_id === local.id;
}

export async function ensureLocalServerRecord() {
  const existing = await getServerByHostname(config.serverId);
  const metadata = normalizeMetadata(existing?.metadata);

  if (existing) {
    await query(
      `UPDATE servers
       SET role = $2, max_streams = $3, is_active = true
       WHERE id = $1`,
      [existing.id, config.serverRole, config.streaming.maxConcurrent]
    );
    return getServerById(existing.id);
  }

  const result = await query(
    `INSERT INTO servers (name, hostname, role, max_streams, is_active, last_heartbeat, metadata)
     VALUES ($1, $2, $3, $4, true, NOW(), $5)
     RETURNING *`,
    [
      `Server ${config.serverId}`,
      config.serverId,
      config.serverRole,
      config.streaming.maxConcurrent,
      JSON.stringify(metadata),
    ]
  );

  log.info({ serverId: config.serverId, role: config.serverRole }, 'Local server registered');
  return decorateServer(result.rows[0]);
}

export async function listServers({ includeInactive = false } = {}) {
  const sql = includeInactive
    ? 'SELECT * FROM servers ORDER BY name ASC, created_at ASC'
    : 'SELECT * FROM servers WHERE is_active = true ORDER BY name ASC, created_at ASC';
  const result = await query(sql);
  return result.rows.map((row) => {
    const server = decorateServer(row);
    if (server.is_local && !server.host_stats) {
      return attachLiveStats(server);
    }
    return server;
  });
}

export async function getClusterSummary() {
  const servers = await listServers();
  const streamServers = servers.filter((s) => s.is_active && canRunStreams(s.role));
  const online = streamServers.filter((s) => s.online && !s.is_suspended);
  const totalMax = online.reduce((sum, s) => sum + (Number(s.max_streams) || 0), 0);
  const totalCurrent = online.reduce((sum, s) => sum + (Number(s.current_streams) || 0), 0);
  const withStats = online.filter((s) => s.host_stats?.cpu);
  const avgCpu = withStats.length > 0
    ? Math.round(withStats.reduce((sum, s) => sum + (s.cpu_percent || 0), 0) / withStats.length)
    : null;
  const maxCpu = withStats.length > 0
    ? Math.max(...withStats.map((s) => s.cpu_percent || 0))
    : null;

  return {
    total_servers: servers.length,
    stream_servers: streamServers.length,
    online_servers: online.length,
    total_max_streams: totalMax,
    total_current_streams: totalCurrent,
    cluster_load_percent: totalMax > 0 ? Math.round((totalCurrent / totalMax) * 100) : 0,
    avg_cpu_percent: avgCpu,
    max_cpu_percent: maxCpu,
    local_server_id: (await getLocalServer())?.id || null,
    local_hostname: config.serverId,
  };
}

export async function suggestNextHostname() {
  const result = await query('SELECT hostname FROM servers');
  const used = new Set(result.rows.map((r) => r.hostname));
  let n = 2;
  while (used.has(`node-${n}`)) n += 1;
  return `node-${n}`;
}

export async function createServer(data) {
  const hostname = String(data.hostname || '').trim();
  if (!hostname) throw new Error('hostname مطلوب — يجب أن يطابق SERVER_ID على جهاز البث');

  const duplicate = await query('SELECT * FROM servers WHERE hostname = $1', [hostname]);
  if (duplicate.rows.length > 0) {
    const existing = duplicate.rows[0];
    if (!existing.is_active) {
      const prevMeta = typeof existing.metadata === 'string'
        ? (() => { try { return JSON.parse(existing.metadata); } catch { return {}; } })()
        : (existing.metadata || {});
      const metadata = normalizeMetadata({
        ...prevMeta,
        hls_base_url: data.hls_base_url,
        public_base_url: data.public_base_url,
        ...(data.metadata || {}),
      });
      const result = await query(
        `UPDATE servers
         SET name = $2,
             ip_address = $3,
             role = $4,
             max_streams = $5,
             is_active = true,
             metadata = $6,
             last_heartbeat = NULL,
             current_streams = 0
         WHERE id = $1
         RETURNING *`,
        [
          existing.id,
          String(data.name || hostname).trim(),
          data.ip_address || null,
          data.role || 'stream-only',
          Number(data.max_streams) || 100,
          JSON.stringify(metadata),
        ]
      );
      return decorateServer(result.rows[0]);
    }
    const next = await suggestNextHostname();
    throw new Error(
      `يوجد سيرفر نشط بنفس hostname (${hostname}) — استخدم ${next} أو احذف السيرفر القديم من القائمة`
    );
  }

  const metadata = normalizeMetadata({
    hls_base_url: data.hls_base_url,
    public_base_url: data.public_base_url,
    ...(data.metadata || {}),
  });

  const result = await query(
    `INSERT INTO servers (name, hostname, ip_address, role, max_streams, is_active, metadata)
     VALUES ($1, $2, $3, $4, $5, true, $6)
     RETURNING *`,
    [
      String(data.name || hostname).trim(),
      hostname,
      data.ip_address || null,
      data.role || 'stream-only',
      Number(data.max_streams) || 100,
      JSON.stringify(metadata),
    ]
  );

  return decorateServer(result.rows[0]);
}

export async function updateServer(id, data) {
  const existing = await getServerById(id);
  if (!existing) return null;

  const rawMeta = await getServerMetadataRaw(id);
  const metadata = normalizeMetadata({
    ...rawMeta,
    hls_base_url: data.hls_base_url ?? rawMeta?.hls_base_url,
    public_base_url: data.public_base_url ?? rawMeta?.public_base_url,
    ...(data.metadata || {}),
  });

  const result = await query(
    `UPDATE servers
     SET name = COALESCE($2, name),
         ip_address = COALESCE($3, ip_address),
         role = COALESCE($4, role),
         max_streams = COALESCE($5, max_streams),
         is_active = COALESCE($6, is_active),
         metadata = $7
     WHERE id = $1
     RETURNING *`,
    [
      id,
      data.name?.trim() || null,
      data.ip_address || null,
      data.role || null,
      data.max_streams != null ? Number(data.max_streams) : null,
      data.is_active != null ? !!data.is_active : null,
      JSON.stringify(metadata),
    ]
  );

  return decorateServer(result.rows[0] || null);
}

export async function deleteServer(id) {
  const rowResult = await query('SELECT * FROM servers WHERE id = $1', [id]);
  const row = rowResult.rows[0];
  if (!row) throw new Error('السيرفر غير موجود');
  if (row.hostname === config.serverId) {
    throw new Error('لا يمكن حذف السيرفر الرئيسي (هذا الجهاز)');
  }

  const runningResult = await query(
    `SELECT id FROM channels
     WHERE server_id = $1 AND status IN ('running', 'starting', 'restarting') AND is_active = true`,
    [id]
  );

  if (runningResult.rows.length > 0) {
    const { enqueueStreamJob } = await import('./queue.service.js');
    for (let i = 0; i < runningResult.rows.length; i += 1) {
      await enqueueStreamJob(
        'stop-channel',
        runningResult.rows[i].id,
        { delay: i * 200 },
        { options: { manual: true } }
      );
    }
    await query(
      `UPDATE channels SET status = 'stopped' WHERE server_id = $1 AND status IN ('running', 'starting', 'restarting')`,
      [id]
    );
  }

  await query('UPDATE channels SET server_id = NULL WHERE server_id = $1', [id]);
  await query('UPDATE servers SET is_active = false, current_streams = 0 WHERE id = $1', [id]);

  return {
    success: true,
    message: 'تم حذف السيرفر — لن يظهر في القائمة',
    stopped_channels: runningResult.rows.length,
  };
}

export async function suspendServer(id) {
  const server = await getServerById(id);
  if (!server) throw new Error('السيرفر غير موجود');
  if (!server.is_active) throw new Error('لا يمكن تعليق سيرفر معطّل');
  if (server.is_suspended) {
    return { server, stopped: 0, pinned_channels: 0, already: true };
  }

  await patchServerMetadata(id, {
    suspended: true,
    suspended_at: new Date().toISOString(),
  });

  const [runningResult, pinnedResult] = await Promise.all([
    query(
      `SELECT id FROM channels
       WHERE server_id = $1 AND status IN ('running', 'starting', 'restarting') AND is_active = true`,
      [id]
    ),
    query(
      `SELECT COUNT(*) AS count FROM channels WHERE server_id = $1 AND is_active = true`,
      [id]
    ),
  ]);

  const { enqueueStreamJob } = await import('./queue.service.js');
  let stopped = 0;
  for (let i = 0; i < runningResult.rows.length; i += 1) {
    await enqueueStreamJob(
      'stop-channel',
      runningResult.rows[i].id,
      { delay: i * 300 },
      { options: { manual: true } }
    );
    stopped += 1;
  }

  const updated = await getServerById(id);
  return {
    server: updated,
    stopped,
    pinned_channels: parseInt(pinnedResult.rows[0].count, 10),
  };
}

export async function unsuspendServer(id) {
  const server = await getServerById(id);
  if (!server) throw new Error('السيرفر غير موجود');
  if (!server.is_suspended) {
    return { server, already: true };
  }

  await patchServerMetadata(id, {
    suspended: undefined,
    suspended_at: undefined,
  });

  return { server: await getServerById(id) };
}

export async function refreshServerStreamCount(serverId) {
  if (!serverId) return 0;
  const result = await query(
    `SELECT COUNT(*) AS count FROM channels
     WHERE server_id = $1 AND status IN ('running', 'starting', 'restarting') AND is_active = true`,
    [serverId]
  );
  const count = parseInt(result.rows[0].count, 10);
  await query(
    `UPDATE servers SET current_streams = $2 WHERE id = $1`,
    [serverId, count]
  );
  return count;
}

export async function heartbeatLocalServer(activeCount = null) {
  const local = await ensureLocalServerRecord();
  if (!local) return null;

  let count = activeCount;
  if (count == null) {
    const result = await query(
      `SELECT COUNT(*) AS count FROM channels
       WHERE server_id = $1 AND status IN ('running', 'starting', 'restarting') AND is_active = true`,
      [local.id]
    );
    count = parseInt(result.rows[0].count, 10);
  }

  const rawMeta = await getServerMetadataRaw(local.id);
  let hostStats = rawMeta?.host_stats || null;
  try {
    hostStats = getHostMetricsSnapshot();
  } catch (err) {
    log.warn({ err: err.message }, 'Host metrics snapshot failed');
    hostStats = {
      collected_at: new Date().toISOString(),
      error: err.message,
      cpu: { usage_percent: 0, cores: 0, model: '—', load_1: 0, load_5: 0, load_15: 0 },
      memory: { usage_percent: 0, total_bytes: 0, used_bytes: 0 },
    };
  }

  const httpPort = parseInt(process.env.STREAMRELAY_HTTP_PORT || '8080', 10);
  const serverIp = String(process.env.SERVER_IP || config.public?.lanIp || '').trim();
  const metadata = normalizeMetadata({
    ...rawMeta,
    host_stats: hostStats,
  });

  if (serverIp && serverIp !== '127.0.0.1' && !serverIp.startsWith('172.')) {
    metadata.hls_base_url = `http://${serverIp}:${httpPort}/api/hls`;
    metadata.public_base_url = `http://${serverIp}:${httpPort}`;
  }

  await query(
    `UPDATE servers
     SET current_streams = $2,
         last_heartbeat = NOW(),
         metadata = $3,
         ip_address = COALESCE(NULLIF($4, ''), ip_address)
     WHERE id = $1`,
    [local.id, count, JSON.stringify(metadata), serverIp || null]
  );

  return getServerById(local.id);
}

export function startLocalServerHeartbeat() {
  const tick = () => {
    heartbeatLocalServer(null).catch((err) => {
      log.warn({ err: err.message }, 'Server stats heartbeat failed');
    });
  };
  tick();
  const interval = setInterval(tick, 30_000);
  interval.unref();
  log.info('Server stats heartbeat started (every 30s)');
}

export function getHlsBaseForServer(server) {
  const httpPort = parseInt(process.env.STREAMRELAY_HTTP_PORT || String(getPublicUrls().webPort || 8080), 10);
  const ip = server?.ip_address ? String(server.ip_address).trim() : '';
  const fromIp = ip ? `http://${ip}:${httpPort}/api/hls` : null;

  const configured = server?.metadata?.hls_base_url
    ? String(server.metadata.hls_base_url).trim().replace(/\/$/, '')
    : null;

  if (fromIp && configured) {
    try {
      const configuredHost = new URL(configured).hostname;
      const ipHost = ip.split('/')[0];
      if (configuredHost !== ipHost) {
        return fromIp;
      }
    } catch {
      return fromIp;
    }
  }

  if (configured) return configured;
  if (fromIp) return fromIp;
  return getPublicUrls().hlsBase;
}

export async function resolveHlsBaseForChannel(channel) {
  if (!channel) return getPublicUrls().hlsBase;

  if (channel.server_id) {
    const server = await getServerById(channel.server_id);
    if (server) return getHlsBaseForServer(server);
  }

  if (channel.output_url) {
    const match = String(channel.output_url).match(/^(.+)\/[^/]+\/index\.m3u8/i);
    if (match) return match[1];
  }

  return getPublicUrls().hlsBase;
}

export async function resolvePanelPlaybackBase(channel) {
  const directBase = await resolveHlsBaseForChannel(channel);
  const local = await getLocalServer();
  const isRemote = !!(local && channel?.server_id && channel.server_id !== local.id);
  if (isRemote) return getPublicUrls().hlsBase;
  return directBase;
}

export async function assignServerForChannel(channelId) {
  const channelResult = await query('SELECT id, server_id FROM channels WHERE id = $1', [channelId]);
  const channel = channelResult.rows[0];
  if (!channel) throw new Error('Channel not found');

  const candidates = await query(
    `SELECT * FROM servers
     WHERE is_active = true AND role IN ('full', 'stream-only')
     ORDER BY name ASC`
  );

  const streamServers = candidates.rows.map(decorateServer);
  const onlineServers = streamServers.filter((s) => s.online && !s.is_suspended);

  if (channel.server_id) {
    const pinned = streamServers.find((s) => s.id === channel.server_id);
    if (!pinned || !pinned.is_active) {
      throw new Error('السيرفر المحدد للقناة غير موجود أو معطّل');
    }
    if (pinned.is_suspended) {
      throw new Error(`السيرفر «${pinned.name}» معلّق — أزل التعليق أو غيّر سيرفر القناة`);
    }
    if (!pinned.online) {
      throw new Error(`السيرفر «${pinned.name}» غير متصل — شغّله أو غيّر اختيار القناة`);
    }
    if (pinned.current_streams >= pinned.max_streams) {
      throw new Error(`السيرفر «${pinned.name}» ممتلئ (${pinned.current_streams}/${pinned.max_streams})`);
    }
    return pinned;
  }

  const pool = onlineServers.filter((s) => s.current_streams < s.max_streams);
  if (pool.length === 0) {
    const local = await getLocalServer();
    if (local && canRunStreams(local.role) && !local.is_suspended && local.current_streams < local.max_streams) {
      return local;
    }
    throw new Error('لا يوجد سيرفر بث متاح — أضف سيرفراً أو خفّف الحمل');
  }

  pool.sort((a, b) => {
    const loadA = a.current_streams / Math.max(a.max_streams, 1);
    const loadB = b.current_streams / Math.max(b.max_streams, 1);
    if (loadA !== loadB) return loadA - loadB;
    return a.current_streams - b.current_streams;
  });

  return pool[0];
}

export async function buildStreamJobPayload(channelId, action = 'start') {
  if (action === 'stop' || action === 'restart') {
    const channelResult = await query('SELECT id, server_id FROM channels WHERE id = $1', [channelId]);
    const channel = channelResult.rows[0];
    if (!channel) throw new Error('Channel not found');

    if (channel.server_id) {
      const server = await getServerById(channel.server_id);
      if (server) {
        return {
          channelId,
          targetServerId: server.hostname,
          targetServerUuid: server.id,
        };
      }
    }

    const local = await ensureLocalServerRecord();
    return {
      channelId,
      targetServerId: local.hostname,
      targetServerUuid: local.id,
    };
  }

  const server = await assignServerForChannel(channelId);
  return {
    channelId,
    targetServerId: server.hostname,
    targetServerUuid: server.id,
  };
}

export async function assertChannelAssignedToLocal(channel) {
  const local = await getLocalServer();
  if (!local) throw new Error('Local server not registered');

  if (local.is_suspended) {
    throw new Error('هذا السيرفر معلّق — أزل التعليق من لوحة السيرفرات');
  }

  if (channel.server_id && channel.server_id !== local.id) {
    const assigned = await getServerById(channel.server_id);
    if (assigned?.is_suspended) {
      throw new Error(`السيرفر «${assigned.name}» معلّق — أزل التعليق أو غيّر سيرفر القناة`);
    }
    throw new Error(
      `القناة مربوطة بـ «${assigned?.name || 'سيرفر آخر'}» (${assigned?.hostname || '—'})`
    );
  }

  return local;
}

export async function bindChannelToServer(channelId, server, slug) {
  const hlsBase = getHlsBaseForServer(server);
  await query(
    `UPDATE channels SET server_id = $2, output_url = $3 WHERE id = $1`,
    [channelId, server.id, `${hlsBase}/${slug}/index.m3u8`]
  );
  await refreshServerStreamCount(server.id);
}

export async function releaseChannelFromServer(channelId) {
  const channelResult = await query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
  const serverId = channelResult.rows[0]?.server_id;
  if (!serverId) return;
  await refreshServerStreamCount(serverId);
}
