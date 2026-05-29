import * as channelService from './channel.service.js';
import {
  getActiveStreams,
  scheduleAutoRestart,
  scheduleAutoStart,
  startStream,
} from './stream.service.js';
import { startBandwidthTracking } from './bandwidth.service.js';
import { checkProcessAlive } from '../utils/process.js';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('stream-recovery');

function channelNeedsStart(channel, activeMap) {
  const inMemory = activeMap.get(channel.id);
  const pidAlive = channel.pid ? checkProcessAlive(channel.pid) : false;
  return !(inMemory?.alive || pidAlive);
}

export async function recoverStreamsOnStartup() {
  const delayMs = config.streaming.startupRecoveryDelayMs;
  log.info({ delayMs }, 'Waiting before auto-starting all channels');

  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const { getLocalServer } = await import('./server.service.js');
  const localServer = await getLocalServer();

  const channels = await channelService.getChannelsForAutoStart();
  const activeMap = new Map(getActiveStreams().map((s) => [s.channelId, s]));
  let queued = 0;

  for (const channel of channels) {
    if (localServer && channel.server_id && channel.server_id !== localServer.id) {
      continue;
    }

    if (!channelNeedsStart(channel, activeMap)) {
      if (channel.pid && checkProcessAlive(channel.pid)) {
        startBandwidthTracking(channel.id, channel.pid, channel.slug, channel.name);
      }
      continue;
    }

    log.info(
      { channelId: channel.id, slug: channel.slug, status: channel.status },
      'Auto-starting channel after server boot'
    );

    try {
      await scheduleAutoStart(channel.id, { delay: queued * 400 });
      queued += 1;
    } catch (err) {
      log.warn({ channelId: channel.id, err: err.message }, 'Failed to queue startup start');
      try {
        await startStream(channel.id);
      } catch (startErr) {
        log.warn({ channelId: channel.id, err: startErr.message }, 'Startup start failed');
        await scheduleAutoRestart(channel.id);
      }
    }
  }

  log.info({ queued, total: channels.length }, 'Startup channel recovery complete');
}
