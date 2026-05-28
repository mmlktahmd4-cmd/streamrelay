import Redis from 'ioredis';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('online-presence');

const VIEWER_TTL_SEC = 120;
const KEY_PREFIX = 'sr:presence:viewer:';

let redis = null;

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
      log.warn({ err: err.message }, 'Redis presence error');
    });
  }
  return redis;
}

function normalizeIp(ip) {
  if (!ip) return null;
  return String(ip).replace(/^::ffff:/, '');
}

/** تسجيل حضور مشاهد فقط — لا يُحسب المدير/المشغّل */
export async function touchViewerPresence(user, meta = {}) {
  if (!user?.id || user.role !== 'viewer') return;

  const payload = JSON.stringify({
    userId: user.id,
    username: user.username || user.id,
    role: user.role,
    ip: normalizeIp(meta.ip),
    lastSeen: Date.now(),
  });

  try {
    const r = getRedis();
    await r.set(`${KEY_PREFIX}${user.id}`, payload, 'EX', VIEWER_TTL_SEC);
  } catch (err) {
    log.debug({ err: err.message, userId: user.id }, 'Presence touch failed');
  }
}

/** @deprecated — استخدم touchViewerPresence */
export function touchOnlineUser(user, meta = {}) {
  touchViewerPresence(user, meta).catch(() => {});
}

export async function getOnlineViewers() {
  try {
    const r = getRedis();
    const keys = await r.keys(`${KEY_PREFIX}*`);
    if (!keys.length) return [];

    const rows = await r.mget(keys);
    const viewers = [];

    for (const raw of rows) {
      if (!raw) continue;
      try {
        const item = JSON.parse(raw);
        viewers.push({
          userId: item.userId,
          username: item.username,
          role: item.role || 'viewer',
          ip: item.ip || null,
          lastSeen: item.lastSeen || Date.now(),
        });
      } catch { /* ignore */ }
    }

    return viewers.sort((a, b) => b.lastSeen - a.lastSeen);
  } catch (err) {
    log.debug({ err: err.message }, 'getOnlineViewers failed');
    return [];
  }
}

export async function getOnlineViewersCount() {
  const viewers = await getOnlineViewers();
  return viewers.length;
}

export async function removeViewerPresence(userId) {
  if (!userId) return;
  try {
    const r = getRedis();
    await r.del(`${KEY_PREFIX}${userId}`);
  } catch { /* ignore */ }
}
