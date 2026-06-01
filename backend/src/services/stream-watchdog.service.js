import * as channelService from './channel.service.js';
import {
  getActiveStreams,
  scheduleAutoRestart,
  wasManuallyStopped,
} from './stream.service.js';
import { checkProcessAlive } from '../utils/process.js';
import { probeHlsManifest } from '../utils/metrics.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('stream-watchdog');

const STUCK_START_MS = 240000;
const STALE_HLS_MS = 60000;

function processAlive(channel, activeMap) {
  const inMemory = activeMap.get(channel.id);
  if (inMemory?.alive) return true;
  if (channel.pid && checkProcessAlive(channel.pid)) return true;
  return false;
}

/** مراقبة FFmpeg — مثل pid_monitor.php في Xtream UI */
export async function runStreamWatchdog() {
  const { isChannelAssignedToLocalWorker } = await import('./server.service.js');
  const { recoverOnDemandIfViewersActive, kickOnDemandStream } = await import('./on-demand.service.js');
  const { hasOnDemandViewerPulse } = await import('./on-demand-presence.service.js');

  const liveChannels = await channelService.getRunningChannels();
  const activeMap = new Map(getActiveStreams().map((s) => [s.channelId, s]));
  const results = { recovered: 0, reset: 0, kicked: 0, checked: 0 };
  const channels = liveChannels;

  for (const channel of channels) {
    if (!(await isChannelAssignedToLocalWorker(channel))) continue;
    results.checked += 1;

    if (['starting', 'restarting'].includes(channel.status)) {
      const age = Date.now() - new Date(channel.updated_at).getTime();
      if (age > STUCK_START_MS) {
        const { cancelChannelJobs } = await import('./queue.service.js');
        await cancelChannelJobs(channel.id);
        await channelService.updateChannelStatus(channel.id, 'stopped', {
          pid: null,
          last_error: channel.on_demand ? 'انتهت مهلة الإقلاع — أعد المحاولة' : 'Startup timeout',
        });
        results.reset += 1;
        log.warn({ channelId: channel.id }, 'Watchdog reset stuck starting channel');
      }
      continue;
    }

    if (channel.status !== 'running') continue;

    const alive = processAlive(channel, activeMap);

    if (!alive) {
      if (wasManuallyStopped(channel.id)) continue;

      if (channel.on_demand) {
        if (await hasOnDemandViewerPulse(channel.id)) {
          await recoverOnDemandIfViewersActive(channel.id);
          results.kicked += 1;
        } else {
          await channelService.updateChannelStatus(channel.id, 'stopped', { pid: null, last_error: null });
          results.reset += 1;
        }
      } else if (channel.auto_restart) {
        await channelService.updateChannelStatus(channel.id, 'error', {
          pid: null,
          last_error: 'FFmpeg process missing',
          failure_count: (channel.failure_count || 0) + 1,
        });
        await scheduleAutoRestart(channel.id);
        results.recovered += 1;
      } else {
        await channelService.updateChannelStatus(channel.id, 'error', {
          pid: null,
          last_error: 'FFmpeg process missing',
        });
        results.reset += 1;
      }
      continue;
    }

    if (channel.output_format === 'hls' && !channel.on_demand) {
      const hls = await probeHlsManifest(channel.id, STALE_HLS_MS);
      if (!hls.alive) {
        const { recoverStaleStream } = await import('./stream.service.js');
        await recoverStaleStream(channel.id);
        results.recovered += 1;
      }
    }
  }

  const { query } = await import('../db/pool.js');
  const stoppedOnDemand = await query(
    `SELECT * FROM channels
     WHERE is_active = true AND on_demand = true AND status = 'stopped'`
  );
  for (const channel of stoppedOnDemand.rows) {
    if (!(await isChannelAssignedToLocalWorker(channel))) continue;
    if (!(await hasOnDemandViewerPulse(channel.id))) continue;
    try {
      await kickOnDemandStream(channel.id);
      results.kicked += 1;
    } catch (err) {
      log.warn({ channelId: channel.id, err: err.message }, 'Watchdog on-demand kick failed');
    }
  }

  if (results.recovered || results.reset || results.kicked) {
    log.info(results, 'Stream watchdog actions');
  }

  return results;
}
