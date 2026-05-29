import fs from 'fs/promises';
import path from 'path';
import Redis from 'ioredis';
import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { createChildLogger } from '../utils/logger.js';
import { checkProcessAlive } from '../utils/process.js';
import * as channelService from './channel.service.js';

const log = createChildLogger('bandwidth');

const PREFIX = 'sr:bandwidth:';
const SERVER_PREFIX = `${PREFIX}server:`;
const POLL_MS = 1000;
const BPS_WINDOW_SEC = 3;
const CHANNEL_TTL_SEC = 30;
const SERVER_TTL_SEC = 20;

let redis = null;
const trackers = new Map();
const hlsSamples = new Map();
const egressSamples = new Map();
const egressAccum = new Map();

let prevNetSample = null;
let cachedHostRxBps = 0;
let cachedHostTxBps = 0;
let hostNetTimer = null;
let monitorTimer = null;
let latestSnapshot = null;
let slugToChannel = new Map();

function getRedis() {
  if (!redis) {
    redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    redis.on('error', (err) => {
      log.warn({ err: err.message }, 'Redis bandwidth error');
    });
  }
  return redis;
}

function rollingBps(prev, deltaBytes, now) {
  const window = [...(prev?.window || []), { bytes: deltaBytes, at: now }]
    .filter((entry) => now - entry.at <= BPS_WINDOW_SEC * 1000);

  const totalBytes = window.reduce((sum, entry) => sum + entry.bytes, 0);
  const spanSec = Math.min(
    BPS_WINDOW_SEC,
    window.length > 1 ? (now - window[0].at) / 1000 : POLL_MS / 1000
  );

  const bps = spanSec >= 0.3 ? Math.round((totalBytes * 8) / spanSec) : (prev?.bps || 0);
  return { bps, window };
}

async function samplePullBandwidth(channelId, slug) {
  const dir = path.join(config.streaming.hlsDir, slug);
  const now = Date.now();
  const prev = hlsSamples.get(channelId) || {
    fileStates: {},
    sessionBytes: 0,
    at: now,
    bps: 0,
    window: [],
  };

  let deltaBytes = 0;
  const fileStates = { ...prev.fileStates };

  try {
    const files = await fs.readdir(dir);
    const tsFiles = new Set(files.filter((f) => f.endsWith('.ts')));

    for (const file of tsFiles) {
      const fp = path.join(dir, file);
      const stat = await fs.stat(fp);
      const old = fileStates[file];
      if (!old) {
        fileStates[file] = { size: stat.size, mtimeMs: stat.mtimeMs };
        // HLS يحذف القطع بسرعة — نحسب الحجم مرة عند اكتمال القطعة (~250ms+)
        if (stat.size > 0 && now - stat.mtimeMs >= 250) {
          deltaBytes += stat.size;
        }
        continue;
      }
      const grown = stat.size - (old.size || 0);
      if (grown > 0) deltaBytes += grown;
      fileStates[file] = { size: stat.size, mtimeMs: stat.mtimeMs };
    }

    for (const file of Object.keys(fileStates)) {
      if (!tsFiles.has(file)) delete fileStates[file];
    }
  } catch {
    /* channel dir may not exist yet */
  }

  const sessionBytes = (prev.sessionBytes || 0) + deltaBytes;
  const { bps, window } = rollingBps(prev, deltaBytes, now);

  hlsSamples.set(channelId, {
    fileStates,
    sessionBytes,
    at: now,
    bps,
    window,
  });

  return { pull_bps: bps, pull_session_bytes: sessionBytes };
}

function pruneMaps(activeIds, activeSlugs) {
  for (const id of hlsSamples.keys()) {
    if (!activeIds.has(id)) hlsSamples.delete(id);
  }
  for (const slug of egressSamples.keys()) {
    if (!activeSlugs.has(slug)) egressSamples.delete(slug);
  }
  for (const slug of egressAccum.keys()) {
    if (!activeSlugs.has(slug)) egressAccum.delete(slug);
  }
}

function sampleEgressBandwidth(slug) {
  const now = Date.now();
  const delta = egressAccum.get(slug) || 0;
  egressAccum.set(slug, 0);

  const prev = egressSamples.get(slug) || { sessionBytes: 0, bps: 0, at: now, window: [] };
  const sessionBytes = (prev.sessionBytes || 0) + delta;
  const { bps, window } = rollingBps(prev, delta, now);

  egressSamples.set(slug, { sessionBytes, bps, at: now, window });
  return { egress_bps: bps, egress_session_bytes: sessionBytes };
}

export function recordEgressBytes(slug, bytes) {
  const value = parseInt(bytes, 10);
  if (!slug || !Number.isFinite(value) || value <= 0) return;
  const key = decodeURIComponent(String(slug));
  egressAccum.set(key, (egressAccum.get(key) || 0) + value);
}

async function sampleHostNetwork() {
  if (process.platform !== 'linux') {
    return { rxBps: cachedHostRxBps, txBps: cachedHostTxBps };
  }

  try {
    const raw = await fs.readFile('/proc/net/dev', 'utf8');
    let rxBytes = 0;
    let txBytes = 0;

    for (const line of raw.split('\n').slice(2)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 10) continue;
      const iface = parts[0].replace(':', '');
      if (iface === 'lo') continue;
      if (iface.startsWith('docker') || iface.startsWith('br-') || iface.startsWith('veth')) continue;
      rxBytes += parseInt(parts[1], 10) || 0;
      txBytes += parseInt(parts[9], 10) || 0;
    }

    const now = Date.now();
    if (prevNetSample) {
      const dt = (now - prevNetSample.at) / 1000;
      if (dt > 0) {
        cachedHostRxBps = Math.max(0, Math.round(((rxBytes - prevNetSample.rx) * 8) / dt));
        cachedHostTxBps = Math.max(0, Math.round(((txBytes - prevNetSample.tx) * 8) / dt));
      }
    }
    prevNetSample = { rx: rxBytes, tx: txBytes, at: now };
  } catch (err) {
    log.debug({ err: err.message }, 'Host network sample failed');
  }

  return { rxBps: cachedHostRxBps, txBps: cachedHostTxBps };
}

async function buildSnapshot(runningChannels) {
  const { isChannelAssignedToLocalWorker } = await import('./server.service.js');
  const localChannels = [];
  for (const ch of runningChannels) {
    if (await isChannelAssignedToLocalWorker(ch)) localChannels.push(ch);
  }
  runningChannels = localChannels;

  slugToChannel = new Map(runningChannels.map((ch) => [ch.slug, ch]));
  const activeIds = new Set(runningChannels.map((ch) => ch.id));
  const activeSlugs = new Set(runningChannels.map((ch) => ch.slug));

  const channels = [];
  let totalPullBps = 0;
  let totalPullSession = 0;
  let totalEgressBps = 0;
  let totalEgressSession = 0;

  for (const ch of runningChannels) {
    const pull = await samplePullBandwidth(ch.id, ch.slug);
    const egress = sampleEgressBandwidth(ch.slug);

    channels.push({
      channel_id: ch.id,
      slug: ch.slug,
      name: ch.name,
      pid: ch.pid,
      pull_bps: pull.pull_bps,
      pull_session_bytes: pull.pull_session_bytes,
      egress_bps: egress.egress_bps,
      egress_session_bytes: egress.egress_session_bytes,
      bps: pull.pull_bps,
      session_bytes: pull.pull_session_bytes,
      updated_at: new Date().toISOString(),
    });

    totalPullBps += pull.pull_bps;
    totalPullSession += pull.pull_session_bytes;
    totalEgressBps += egress.egress_bps;
    totalEgressSession += egress.egress_session_bytes;
  }

  pruneMaps(activeIds, activeSlugs);
  const net = await sampleHostNetwork();

  latestSnapshot = {
    total_pull_bps: totalPullBps,
    total_pull_mbps: Math.round((totalPullBps / 1_000_000) * 100) / 100,
    total_pull_session_bytes: totalPullSession,
    total_egress_bps: totalEgressBps,
    total_egress_mbps: Math.round((totalEgressBps / 1_000_000) * 100) / 100,
    total_egress_session_bytes: totalEgressSession,
    host_rx_bps: net.rxBps,
    host_rx_mbps: Math.round((net.rxBps / 1_000_000) * 100) / 100,
    host_tx_bps: net.txBps,
    host_tx_mbps: Math.round((net.txBps / 1_000_000) * 100) / 100,
    channel_count: channels.length,
    channels,
    updated_at: new Date().toISOString(),
    poll_interval_ms: POLL_MS,
    _cachedAt: Date.now(),
  };

  return latestSnapshot;
}

function emptyBandwidthStats() {
  return {
    total_pull_bps: 0,
    total_pull_mbps: 0,
    total_pull_session_bytes: 0,
    total_egress_bps: 0,
    total_egress_mbps: 0,
    total_egress_session_bytes: 0,
    host_rx_bps: 0,
    host_rx_mbps: 0,
    host_tx_bps: 0,
    host_tx_mbps: 0,
    channel_count: 0,
    channels: [],
    updated_at: new Date().toISOString(),
    poll_interval_ms: POLL_MS,
  };
}

async function publishServerSnapshot(snapshot) {
  if (!snapshot) return;
  try {
    const r = getRedis();
    const key = `${SERVER_PREFIX}${config.serverId}`;
    await r.set(
      key,
      JSON.stringify({
        ...snapshot,
        server_id: config.serverId,
        published_at: new Date().toISOString(),
      }),
      'EX',
      SERVER_TTL_SEC
    );
  } catch (err) {
    log.debug({ err: err.message }, 'Publish server bandwidth snapshot failed');
  }
}

async function scanRedisKeys(pattern) {
  const r = getRedis();
  const keys = [];
  let cursor = '0';
  do {
    const [next, found] = await r.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next;
    keys.push(...found);
  } while (cursor !== '0');
  return keys;
}

async function aggregateStatsFromRedis() {
  try {
    const serverKeys = await scanRedisKeys(`${SERVER_PREFIX}*`);
    const snapshots = [];

    for (const key of serverKeys) {
      const raw = await getRedis().get(key);
      if (!raw) continue;
      try {
        snapshots.push(JSON.parse(raw));
      } catch { /* ignore */ }
    }

    if (snapshots.length > 0) {
      const channels = [];
      let totalPullBps = 0;
      let totalPullSession = 0;
      let totalEgressBps = 0;
      let totalEgressSession = 0;
      let hostRxBps = 0;
      let hostTxBps = 0;

      for (const snap of snapshots) {
        totalPullBps += snap.total_pull_bps || 0;
        totalPullSession += snap.total_pull_session_bytes || 0;
        totalEgressBps += snap.total_egress_bps || 0;
        totalEgressSession += snap.total_egress_session_bytes || 0;
        hostRxBps += snap.host_rx_bps || 0;
        hostTxBps += snap.host_tx_bps || 0;
        if (Array.isArray(snap.channels)) channels.push(...snap.channels);
      }

      return {
        total_pull_bps: totalPullBps,
        total_pull_mbps: Math.round((totalPullBps / 1_000_000) * 100) / 100,
        total_pull_session_bytes: totalPullSession,
        total_egress_bps: totalEgressBps,
        total_egress_mbps: Math.round((totalEgressBps / 1_000_000) * 100) / 100,
        total_egress_session_bytes: totalEgressSession,
        host_rx_bps: hostRxBps,
        host_rx_mbps: Math.round((hostRxBps / 1_000_000) * 100) / 100,
        host_tx_bps: hostTxBps,
        host_tx_mbps: Math.round((hostTxBps / 1_000_000) * 100) / 100,
        channel_count: channels.length,
        channels,
        servers: snapshots.map((s) => ({
          server_id: s.server_id,
          total_pull_bps: s.total_pull_bps,
          total_egress_bps: s.total_egress_bps,
          channel_count: s.channel_count,
          updated_at: s.updated_at,
        })),
        updated_at: new Date().toISOString(),
        poll_interval_ms: POLL_MS,
        _cachedAt: Date.now(),
        _source: 'redis-cluster',
      };
    }

    const channelKeys = await scanRedisKeys(`${PREFIX}channel:*`);
    if (channelKeys.length === 0) return null;

    const channels = [];
    let totalPullBps = 0;
    let totalEgressBps = 0;
    let totalPullSession = 0;

    for (const key of channelKeys) {
      const raw = await getRedis().get(key);
      if (!raw) continue;
      try {
        const ch = JSON.parse(raw);
        channels.push(ch);
        totalPullBps += ch.pull_bps || ch.bps || 0;
        totalEgressBps += ch.egress_bps || 0;
        totalPullSession += ch.session_bytes || 0;
      } catch { /* ignore */ }
    }

    return {
      total_pull_bps: totalPullBps,
      total_pull_mbps: Math.round((totalPullBps / 1_000_000) * 100) / 100,
      total_pull_session_bytes: totalPullSession,
      total_egress_bps: totalEgressBps,
      total_egress_mbps: Math.round((totalEgressBps / 1_000_000) * 100) / 100,
      total_egress_session_bytes: 0,
      host_rx_bps: 0,
      host_rx_mbps: 0,
      host_tx_bps: 0,
      host_tx_mbps: 0,
      channel_count: channels.length,
      channels,
      updated_at: new Date().toISOString(),
      poll_interval_ms: POLL_MS,
      _cachedAt: Date.now(),
      _source: 'redis-channels',
    };
  } catch (err) {
    log.debug({ err: err.message }, 'Aggregate Redis bandwidth failed');
    return null;
  }
}

async function tickMonitor() {
  try {
    const { isChannelAssignedToLocalWorker, canRunStreams } = await import('./server.service.js');
    const running = await channelService.getRunningChannels();
    const localChannels = [];
    for (const ch of running) {
      if (await isChannelAssignedToLocalWorker(ch)) localChannels.push(ch);
    }
    const snap = await buildSnapshot(localChannels);
    if (canRunStreams(config.serverRole)) {
      await publishServerSnapshot(snap);
    }
  } catch (err) {
    log.debug({ err: err.message }, 'Bandwidth monitor tick failed');
  }
}

export function startBandwidthMonitor() {
  if (monitorTimer) return;
  tickMonitor().catch(() => {});
  monitorTimer = setInterval(() => tickMonitor().catch(() => {}), POLL_MS);
  monitorTimer.unref();
  log.info({ intervalMs: POLL_MS }, 'Bandwidth monitor started');
}

export function stopBandwidthMonitor() {
  if (!monitorTimer) return;
  clearInterval(monitorTimer);
  monitorTimer = null;
}

async function publishChannelStats(channelId, stats) {
  try {
    const r = getRedis();
    await r.set(`${PREFIX}channel:${channelId}`, JSON.stringify(stats), 'EX', CHANNEL_TTL_SEC);
  } catch { /* ignore */ }
}

async function pollTracker(channelId) {
  const tracker = trackers.get(channelId);
  if (!tracker) return;

  if (!checkProcessAlive(tracker.pid)) {
    stopBandwidthTracking(channelId);
    return;
  }

  const pull = await samplePullBandwidth(channelId, tracker.slug);
  const egress = sampleEgressBandwidth(tracker.slug);
  tracker.bps = pull.pull_bps;
  tracker.sessionBytes = pull.pull_session_bytes;

  await publishChannelStats(channelId, {
    channel_id: channelId,
    slug: tracker.slug,
    name: tracker.name,
    pid: tracker.pid,
    pull_bps: pull.pull_bps,
    egress_bps: egress.egress_bps,
    bps: pull.pull_bps,
    session_bytes: pull.pull_session_bytes,
    updated_at: new Date().toISOString(),
  });
}

export function startBandwidthTracking(channelId, pid, slug, name) {
  stopBandwidthTracking(channelId);

  const tracker = {
    pid,
    slug,
    name: name || slug,
    bps: 0,
    sessionBytes: 0,
    startedAt: Date.now(),
  };

  trackers.set(channelId, tracker);
  pollTracker(channelId).catch(() => {});

  const interval = setInterval(() => pollTracker(channelId).catch(() => {}), POLL_MS);
  interval.unref();
  tracker.interval = interval;
}

export async function stopBandwidthTracking(channelId) {
  const tracker = trackers.get(channelId);
  if (!tracker) return;

  clearInterval(tracker.interval);
  trackers.delete(channelId);

  if (tracker.sessionBytes > 0) {
    try {
      await query(
        `UPDATE stream_sessions SET bytes_sent = $1
         WHERE channel_id = $2 AND stopped_at IS NULL`,
        [tracker.sessionBytes, channelId]
      );
    } catch (err) {
      log.warn({ channelId, err: err.message }, 'Failed to save session bandwidth');
    }
  }

  try {
    const r = getRedis();
    await r.del(`${PREFIX}channel:${channelId}`);
  } catch { /* ignore */ }
}

export function handleFfmpegStderr() {
  /* HLS dir sampling is the source of truth for pull rate */
}

function enrichChannelsWithNames(clusterSnap, runningChannels) {
  if (!clusterSnap?.channels?.length || !runningChannels?.length) return clusterSnap;
  const byId = new Map(runningChannels.map((c) => [c.id, c]));
  clusterSnap.channels = clusterSnap.channels.map((ch) => {
    const db = byId.get(ch.channel_id);
    return db ? { ...ch, name: db.name, slug: db.slug || ch.slug } : ch;
  });
  return clusterSnap;
}

export async function getBandwidthStats(runningChannels = []) {
  const cluster = await aggregateStatsFromRedis();
  if (cluster) {
    return enrichChannelsWithNames(cluster, runningChannels);
  }

  const { isChannelAssignedToLocalWorker } = await import('./server.service.js');
  const filtered = [];
  for (const ch of runningChannels) {
    if (await isChannelAssignedToLocalWorker(ch)) filtered.push(ch);
  }

  if (latestSnapshot && latestSnapshot._cachedAt && Date.now() - latestSnapshot._cachedAt < 1500) {
    if (filtered.length === 0) {
      return { ...emptyBandwidthStats(), host_rx_bps: latestSnapshot.host_rx_bps, host_tx_bps: latestSnapshot.host_tx_bps };
    }
    return latestSnapshot;
  }

  if (filtered.length > 0) {
    return buildSnapshot(filtered);
  }

  if (latestSnapshot) return latestSnapshot;

  return emptyBandwidthStats();
}
