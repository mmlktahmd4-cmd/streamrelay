import * as channelService from './channel.service.js';
import { getActiveStreams, scheduleAutoRestart, startStream } from './stream.service.js';
import { checkProcessAlive } from '../utils/process.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('stream-recovery');

export async function recoverStreamsOnStartup() {
  const [running, errorChannels] = await Promise.all([
    channelService.getRunningChannels(),
    channelService.getErrorChannelsWithAutoRestart(),
  ]);

  const activeMap = new Map(getActiveStreams().map((s) => [s.channelId, s]));
  const seen = new Set();

  for (const channel of [...running, ...errorChannels]) {
    if (seen.has(channel.id)) continue;
    seen.add(channel.id);

    const inMemory = activeMap.get(channel.id);
    const pidAlive = channel.pid ? checkProcessAlive(channel.pid) : false;

    if (inMemory?.alive || pidAlive) {
      continue;
    }

    log.info({ channelId: channel.id, slug: channel.slug, status: channel.status }, 'Recovering stream');

    try {
      await startStream(channel.id);
    } catch (err) {
      log.warn({ channelId: channel.id, err: err.message }, 'Startup recovery failed, scheduling restart');
      await scheduleAutoRestart(channel.id);
    }
  }
}
