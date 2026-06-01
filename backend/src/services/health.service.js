import * as channelService from './channel.service.js';
import { getActiveStreams, scheduleAutoRestart, scheduleAutoStart, wasManuallyStopped } from './stream.service.js';
import { probeHlsManifest } from '../utils/metrics.js';
import { checkProcessAlive } from '../utils/process.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('health');

/** عدّاد فحوص HLS المتوقفة المتتالية قبل إعادة التشغيل */
const staleHlsStrikes = new Map();

const STALE_HLS_MIN_AGE_MS = 120000;
const STALE_HLS_STRIKES_NEEDED = 5;
const STALLED_START_MS = 240000;

export async function checkChannelHealth(channel) {
  const result = {
    channelId: channel.id,
    slug: channel.slug,
    status: channel.status,
    healthy: false,
    checks: {},
  };

  if (channel.output_format === 'hls') {
    const hls = await probeHlsManifest(channel.id, 120000);
    const procAlive = channel.pid ? checkProcessAlive(channel.pid) : false;
    result.checks.hls = hls;
    result.checks.process = { alive: procAlive, pid: channel.pid };
    result.healthy = hls.alive && procAlive;
    return result;
  }

  const procAlive = channel.pid ? checkProcessAlive(channel.pid) : false;
  result.checks.process = { alive: procAlive, pid: channel.pid };
  result.healthy = procAlive;

  return result;
}
export async function runHealthChecks() {
  const { isChannelAssignedToLocalWorker } = await import('./server.service.js');
  const [runningChannels, errorChannels, stoppedChannels] = await Promise.all([
    channelService.getRunningChannels(),
    channelService.getErrorChannelsWithAutoRestart(),
    channelService.getStoppedChannelsWithAutoRestart(),
  ]);
  const activeMap = new Map(getActiveStreams().map((s) => [s.channelId, s]));
  const results = [];
  const handled = new Set();

  for (const channel of runningChannels) {
    if (!(await isChannelAssignedToLocalWorker(channel))) {
      continue;
    }

    // On Demand: لا فحص صحة — يُدار عبر نبضات المشاهدة + idle فقط
    if (channel.on_demand) {
      handled.add(channel.id);
      continue;
    }

    handled.add(channel.id);

    if (channel.status === 'starting' || channel.status === 'restarting') {
      const ageMs = Date.now() - new Date(channel.updated_at).getTime();
      if (ageMs > STALLED_START_MS) {
        log.warn({ channelId: channel.id, slug: channel.slug, ageMs }, 'Channel stuck in starting — resetting');
        const { cancelChannelJobs } = await import('./queue.service.js');
        await cancelChannelJobs(channel.id);
        await channelService.updateChannelStatus(channel.id, 'error', {
          pid: null,
          last_error: 'انتهت مهلة التشغيل — تحقق من رابط المصدر أو السيرفر المربوط',
        });
        await channelService.logStreamEvent(
          channel.id,
          'error',
          'Startup timed out after 3 minutes'
        );
      }
      continue;
    }

    const inMemory = activeMap.get(channel.id);
    const health = await checkChannelHealth(channel);
    results.push(health);

    const procOk = inMemory?.alive || health.checks.process?.alive;
    const hlsOk = channel.output_format !== 'hls' || health.checks.hls?.alive;

    if (procOk && hlsOk) {
      continue;
    }

    if (inMemory?.alive && channel.output_format === 'hls' && !health.checks.hls?.alive) {
      if (channel.on_demand) {
        continue;
      }

      const hlsAge = health.checks.hls?.age_ms;
      if (hlsAge != null && hlsAge < STALE_HLS_MIN_AGE_MS) {
        staleHlsStrikes.delete(channel.id);
        continue;
      }

      const strikes = (staleHlsStrikes.get(channel.id) || 0) + 1;
      staleHlsStrikes.set(channel.id, strikes);

      if (strikes < STALE_HLS_STRIKES_NEEDED) {
        log.debug({ channelId: channel.id, strikes, hlsAge }, 'HLS stale strike');
        continue;
      }

      staleHlsStrikes.delete(channel.id);
      log.warn(
        { channelId: channel.id, slug: channel.slug, hlsAge: health.checks.hls?.age_ms },
        'FFmpeg alive but HLS stale — recovering'
      );
      const { recoverStaleStream } = await import('./stream.service.js');
      await recoverStaleStream(channel.id);
      continue;
    }

    staleHlsStrikes.delete(channel.id);

    if (inMemory?.alive) {
      continue;
    }

    const ownsProcess = inMemory != null;
    const processMissing = ownsProcess && !inMemory.alive && !health.checks.process?.alive;

    if (!health.healthy) {
      log.warn({ channelId: channel.id, slug: channel.slug, checks: health.checks }, 'Unhealthy channel');

      await channelService.logStreamEvent(
        channel.id,
        'warn',
        'Health check failed',
        health.checks
      );

      if (channel.auto_restart && !channel.on_demand) {
        if (channel.pid && processMissing) {
          await channelService.updateChannelStatus(channel.id, 'error', {
            pid: null,
            last_error: 'Process not running',
            failure_count: (channel.failure_count || 0) + 1,
          });
        }
        await scheduleAutoRestart(channel.id);
      }
    }
  }

  for (const channel of errorChannels) {
    if (!(await isChannelAssignedToLocalWorker(channel))) continue;
    if (handled.has(channel.id) || activeMap.has(channel.id)) continue;

    log.info({ channelId: channel.id, slug: channel.slug }, 'Recovering stalled error channel');
    await scheduleAutoStart(channel.id);
    results.push({
      channelId: channel.id,
      slug: channel.slug,
      status: channel.status,
      healthy: false,
      checks: { recovery: true },
    });
  }

  for (const channel of stoppedChannels) {
    if (!(await isChannelAssignedToLocalWorker(channel))) continue;
    if (handled.has(channel.id) || activeMap.has(channel.id)) continue;
    if (wasManuallyStopped(channel.id)) continue;

    log.info({ channelId: channel.id, slug: channel.slug }, 'Auto-starting stopped channel');
    await scheduleAutoStart(channel.id);
    results.push({
      channelId: channel.id,
      slug: channel.slug,
      status: channel.status,
      healthy: false,
      checks: { auto_start: true },
    });
  }

  return results;
}

export async function getHealthSummary() {
  const { isChannelAssignedToLocalWorker } = await import('./server.service.js');
  const channels = await channelService.getRunningChannels();
  let healthy = 0;
  let unhealthy = 0;

  for (const channel of channels) {
    if (!(await isChannelAssignedToLocalWorker(channel))) continue;
    const health = await checkChannelHealth(channel);
    if (health.healthy) healthy++;
    else unhealthy++;
  }

  return {
    total_running: channels.length,
    healthy,
    unhealthy,
    timestamp: new Date().toISOString(),
  };
}

