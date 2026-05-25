import * as channelService from './channel.service.js';
import { getActiveStreams, scheduleAutoRestart } from './stream.service.js';
import { probeHlsManifest } from '../utils/metrics.js';
import { checkProcessAlive } from '../utils/process.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('health');

export async function checkChannelHealth(channel) {
  const result = {
    channelId: channel.id,
    slug: channel.slug,
    status: channel.status,
    healthy: false,
    checks: {},
  };

  if (channel.output_format === 'hls') {
    const hls = await probeHlsManifest(channel.slug);
    const procAlive = channel.pid ? checkProcessAlive(channel.pid) : false;
    result.checks.hls = hls;
    result.checks.process = { alive: procAlive, pid: channel.pid };
    result.healthy = hls.alive || procAlive;
    return result;
  }

  const procAlive = channel.pid ? checkProcessAlive(channel.pid) : false;
  result.checks.process = { alive: procAlive, pid: channel.pid };
  result.healthy = procAlive;

  return result;
}
export async function runHealthChecks() {
  const [runningChannels, errorChannels] = await Promise.all([
    channelService.getRunningChannels(),
    channelService.getErrorChannelsWithAutoRestart(),
  ]);
  const activeMap = new Map(getActiveStreams().map((s) => [s.channelId, s]));
  const results = [];
  const handled = new Set();

  for (const channel of runningChannels) {
    handled.add(channel.id);
    const inMemory = activeMap.get(channel.id);
    const health = await checkChannelHealth(channel);
    results.push(health);

    const processMissing = !inMemory?.alive && !health.checks.process?.alive;

    if (!health.healthy || processMissing) {
      log.warn({ channelId: channel.id, slug: channel.slug, checks: health.checks }, 'Unhealthy channel');

      await channelService.logStreamEvent(
        channel.id,
        'warn',
        'Health check failed',
        health.checks
      );

      if (channel.auto_restart) {
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
    if (handled.has(channel.id) || activeMap.has(channel.id)) continue;

    log.info({ channelId: channel.id, slug: channel.slug }, 'Recovering stalled error channel');
    await scheduleAutoRestart(channel.id);
    results.push({
      channelId: channel.id,
      slug: channel.slug,
      status: channel.status,
      healthy: false,
      checks: { recovery: true },
    });
  }

  return results;
}

export async function getHealthSummary() {
  const channels = await channelService.getRunningChannels();
  let healthy = 0;
  let unhealthy = 0;

  for (const channel of channels) {
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

