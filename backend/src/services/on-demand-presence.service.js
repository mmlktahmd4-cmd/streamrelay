import Redis from 'ioredis';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('on-demand-presence');

const PREFIX = 'sr:ondemand:view:';

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
      log.warn({ err: err.message }, 'Redis on-demand presence error');
    });
  }
  return redis;
}

function pulseTtlSec() {
  return Math.max(60, Math.min(300, config.streaming.onDemandViewerPulseSec || 120));
}

/** نبضة مشاهدة — تُحدَّث مع كل طلب HLS (مشتركة بين API/worker عبر Redis) */
export async function pulseOnDemandViewer(channelId) {
  if (!channelId) return;
  try {
    const r = getRedis();
    await r.set(`${PREFIX}${channelId}`, String(Date.now()), 'EX', pulseTtlSec());
  } catch {
    /* Redis غير متاح — يعتمد النظام على الذاكرة المحلية */
  }
}

export async function hasOnDemandViewerPulse(channelId) {
  if (!channelId) return false;
  try {
    const r = getRedis();
    return (await r.exists(`${PREFIX}${channelId}`)) === 1;
  } catch {
    return false;
  }
}

export async function clearOnDemandViewerPulse(channelId) {
  if (!channelId) return;
  try {
    const r = getRedis();
    await r.del(`${PREFIX}${channelId}`);
  } catch { /* ignore */ }
}
