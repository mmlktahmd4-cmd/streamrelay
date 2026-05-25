import Bull from 'bull';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('queue');

let streamQueue = null;
let processorsRegistered = false;

export function getQueue() {
  if (!streamQueue) {
    const redisOpts = {
      host: config.redis.host,
      port: config.redis.port,
    };
    if (config.redis.password) redisOpts.password = config.redis.password;

    streamQueue = new Bull('streamrelay-jobs', { redis: redisOpts });

    streamQueue.on('error', (err) => log.error({ err }, 'Queue error'));
    streamQueue.on('failed', (job, err) => log.error({ jobId: job.id, err }, 'Job failed'));
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
    const { channelId } = job.data;
    log.info({ channelId }, 'Processing start-channel job');
    const { startStream } = await import('./stream.service.js');
    return startStream(channelId);
  });

  queue.process('stop-channel', async (job) => {
    const { channelId, options = {} } = job.data;
    log.info({ channelId }, 'Processing stop-channel job');
    const { stopStream } = await import('./stream.service.js');
    return stopStream(channelId, options);
  });

  queue.process('restart-channel', async (job) => {
    const { channelId } = job.data;
    log.info({ channelId }, 'Processing restart-channel job');
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
    const { query } = await import('../db/pool.js');

    const stopped = await query(
      `SELECT slug FROM channels WHERE status = 'stopped' AND updated_at < NOW() - INTERVAL '1 hour'`
    );

    for (const row of stopped.rows) {
      const dir = path.join(config.streaming.hlsDir, row.slug);
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch { /* dir may not exist */ }
    }
  });

  // Schedule recurring health checks (refresh on startup so interval changes apply)
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

  // Schedule HLS cleanup every hour
  await queue.add('cleanup-hls', {}, {
    repeat: { every: 3600000 },
    jobId: 'cleanup-hls-recurring',
  });

  log.info('Queue processors registered');
}

export async function runStreamJob(name, data, timeoutMs = 60000) {
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
