import Bull from 'bull';
import { config } from '../config/index.js';
import { buildStreamJobPayload, bindChannelToServer, getServerById } from './server.service.js';
import { query } from '../db/pool.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('queue');

let streamQueue = null;
let processorsRegistered = false;

const DEFER_ERR = 'DEFERRED_TO_TARGET_SERVER';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deferJobToTargetServer(job) {
  if (!job.data?.targetServerId || job.data.targetServerId === config.serverId) {
    return false;
  }
  await job.moveToDelayed(Date.now() + 2500);
  log.debug({ jobId: job.id, target: job.data.targetServerId, local: config.serverId }, 'Job deferred to target server');
  const err = new Error(DEFER_ERR);
  err.code = DEFER_ERR;
  throw err;
}

async function prebindChannelForStart(name, channelId, payload) {
  if (name !== 'start-channel' || !payload?.targetServerUuid) return;
  const ch = await query('SELECT slug FROM channels WHERE id = $1', [channelId]);
  const slug = ch.rows[0]?.slug;
  if (!slug) return;
  const server = await getServerById(payload.targetServerUuid);
  if (server) {
    await bindChannelToServer(channelId, server, slug);
  }
}

async function waitForChannelState(channelId, predicate, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await query(
      'SELECT id, status, last_error FROM channels WHERE id = $1',
      [channelId]
    );
    const ch = r.rows[0];
    if (!ch) throw new Error('القناة غير موجودة');

    const result = predicate(ch);
    if (result === true) return ch;
    if (result && typeof result === 'object') {
      throw new Error(ch.last_error || 'فشل تنفيذ القناة');
    }

    await sleep(intervalMs);
  }
  throw new Error('انتهت مهلة انتظار تنفيذ القناة — تحقق أن worker السيرفر المستهدف يعمل');
}

export function getQueue() {
  if (!streamQueue) {
    const redisOpts = {
      host: config.redis.host,
      port: config.redis.port,
    };
    if (config.redis.password) redisOpts.password = config.redis.password;

    streamQueue = new Bull('streamrelay-jobs', {
      redis: redisOpts,
      // إقلاع 40+ قناة دفعة واحدة يتجاوز القفل الافتراضي (30s) → "Missing lock"
      settings: {
        lockDuration: 120000,
        lockRenewTime: 30000,
        stalledInterval: 60000,
        maxStalledCount: 3,
      },
    });

    streamQueue.on('error', (err) => log.error({ err }, 'Queue error'));
    streamQueue.on('failed', (job, err) => {
      if (err?.code === DEFER_ERR || err?.message === DEFER_ERR) return;
      log.error({ jobId: job?.id, err }, 'Job failed');
    });
  }
  return streamQueue;
}

export async function setupQueueProcessors() {
  if (processorsRegistered) {
    log.debug('Queue processors already registered — skip');
    return;
  }
  processorsRegistered = true;

  const queue = getQueue();

  queue.process('start-channel', async (job) => {
    await deferJobToTargetServer(job);
    const { channelId } = job.data;
    log.info({ channelId, serverId: config.serverId }, 'Processing start-channel job');
    const { startStream } = await import('./stream.service.js');
    return startStream(channelId);
  });

  queue.process('stop-channel', async (job) => {
    await deferJobToTargetServer(job);
    const { channelId, options = {} } = job.data;
    log.info({ channelId, serverId: config.serverId }, 'Processing stop-channel job');
    const { stopStream } = await import('./stream.service.js');
    return stopStream(channelId, options);
  });

  queue.process('restart-channel', async (job) => {
    await deferJobToTargetServer(job);
    const { channelId } = job.data;
    log.info({ channelId, serverId: config.serverId }, 'Processing restart-channel job');
    const channelService = await import('./channel.service.js');
    const channel = await channelService.getChannelById(channelId);
    if (!channel) {
      log.warn({ channelId }, 'Restart job skipped: channel not found');
      return { status: 'skipped', reason: 'channel_not_found' };
    }
    const { restartStream } = await import('./stream.service.js');
    return restartStream(channelId);
  });

  queue.process('import-m3u', async (job) => {
    const { content, categoryId, isPublic } = job.data;
    const channelService = await import('./channel.service.js');
    return channelService.importM3U(content, { categoryId, isPublic });
  });

  queue.process('health-check-all', async () => {
    const { runHealthChecks } = await import('./health.service.js');
    return runHealthChecks();
  });

  queue.process('cleanup-hls', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { query: dbQuery } = await import('../db/pool.js');

    const stopped = await dbQuery(
      `SELECT id, slug FROM channels WHERE status = 'stopped' AND updated_at < NOW() - INTERVAL '1 hour'`
    );

    for (const row of stopped.rows) {
      const dir = path.join(config.streaming.hlsDir, row.id);
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch { /* dir may not exist */ }
      // تنظيف مجلد slug القديم إن وُجد
      const legacyDir = path.join(config.streaming.hlsDir, row.slug);
      try {
        await fs.rm(legacyDir, { recursive: true, force: true });
      } catch { /* dir may not exist */ }
    }
  });

  const repeatable = await queue.getRepeatableJobs();
  for (const job of repeatable) {
    if (job.id === 'health-check-recurring' || job.name === 'health-check-all') {
      await queue.removeRepeatableByKey(job.key);
    }
  }

  await queue.add('health-check-all', {}, {
    repeat: { every: config.streaming.healthCheckInterval },
    jobId: 'health-check-recurring',
  });

  await queue.add('cleanup-hls', {}, {
    repeat: { every: 3600000 },
    jobId: 'cleanup-hls-recurring',
  });

  log.info('Queue processors registered');
}

function jobActionFromName(name) {
  if (name.startsWith('stop')) return 'stop';
  if (name.startsWith('restart')) return 'restart';
  return 'start';
}

export async function enqueueStreamJob(name, channelId, queueOpts = {}, extraData = {}) {
  const payload = await buildStreamJobPayload(channelId, jobActionFromName(name));
  await prebindChannelForStart(name, channelId, payload);
  const queue = getQueue();
  return queue.add(name, { ...payload, ...extraData }, {
    removeOnComplete: true,
    removeOnFail: 50,
    attempts: 30,
    backoff: { type: 'fixed', delay: 2500 },
    ...queueOpts,
  });
}

export async function runStreamJob(name, channelId, extraData = {}, timeoutMs = 120000) {
  const payload = await buildStreamJobPayload(channelId, jobActionFromName(name));
  await prebindChannelForStart(name, channelId, payload);

  const queue = getQueue();
  await queue.add(name, { ...payload, ...extraData }, {
    removeOnComplete: true,
    removeOnFail: 50,
    timeout: timeoutMs,
    attempts: 30,
    backoff: { type: 'fixed', delay: 2500 },
  });

  if (name === 'start-channel') {
    return waitForChannelState(
      channelId,
      (c) => (c.status === 'running' ? true : (c.status === 'error' ? { error: true } : false)),
      timeoutMs
    );
  }

  if (name === 'stop-channel') {
    return waitForChannelState(
      channelId,
      (c) => c.status === 'stopped',
      timeoutMs
    );
  }

  if (name === 'restart-channel') {
    return waitForChannelState(
      channelId,
      (c) => (c.status === 'running' ? true : (c.status === 'error' ? { error: true } : false)),
      timeoutMs
    );
  }

  throw new Error(`Unsupported stream job: ${name}`);
}

export async function runStreamJobLegacy(name, data, timeoutMs = 60000) {
  const queue = getQueue();
  const job = await queue.add(name, data, {
    removeOnComplete: true,
    removeOnFail: 50,
    timeout: timeoutMs,
  });

  try {
    return await job.finished();
  } catch (err) {
    const msg = err?.message || '';
    if (msg.includes('timed out') || msg.includes('Timeout')) {
      throw new Error('انتهت مهلة تشغيل القناة — تحقق أن خدمة worker تعمل أو أعد تشغيل السيرفر');
    }
    throw new Error(msg || `Stream job ${name} failed`);
  }
}

export async function cancelChannelJobs(channelId) {
  const queue = getQueue();
  const jobs = await queue.getJobs(['delayed', 'waiting', 'active']);
  await Promise.all(
    jobs
      .filter((job) => job.data?.channelId === channelId)
      .map((job) => job.remove().catch(() => {}))
  );
}

export async function closeQueue() {
  if (streamQueue) {
    await streamQueue.close();
    streamQueue = null;
  }
}
