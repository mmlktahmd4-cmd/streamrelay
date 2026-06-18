import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import * as channelService from './channel.service.js';
import {
  pulseOnDemandViewer,
  hasOnDemandViewerPulse,
  clearOnDemandViewerPulse,
} from './on-demand-presence.service.js';

const log = createChildLogger('on-demand');

/** channelId → { lastSeen, lastSegment, stopTimer } */
const activity = new Map();

const kickCooldown = new Map();
const KICK_COOLDOWN_MS = 12000;
const STUCK_START_MS = 240000;
/** إذا بقيت القناة في «starting» أطول من هذا — نلغي المهمة ونعيد الإقلاع */
const STUCK_STARTING_KICK_MS = 75000;

function idleTimeoutMs() {
  // مهلة توقّف القناة عند الطلب بعد إغلاق المشاهد لها — الحد الأدنى دقيقتان
  const sec = config.streaming.onDemandIdleTimeoutSec;
  return Math.max(120, Math.min(900, sec)) * 1000;
}

function idleCheckMs() {
  return Math.max(30, Math.min(120, config.streaming.onDemandIdleCheckSec || 60)) * 1000;
}

function lastActivityMs(session) {
  return Math.max(session.lastSeen, session.lastSegment || 0);
}

function hasRecentLocalActivity(channelId) {
  const session = activity.get(channelId);
  if (!session) return false;
  return Date.now() - lastActivityMs(session) < idleTimeoutMs();
}

function clearOnDemandIdleTimer(channelId) {
  const session = activity.get(channelId);
  if (session?.stopTimer) {
    clearInterval(session.stopTimer);
    session.stopTimer = null;
  }
}

export function isOnDemandChannel(channel) {
  return !!channel?.on_demand;
}

export function clearOnDemandSession(channelId) {
  clearOnDemandIdleTimer(channelId);
  activity.delete(channelId);
  clearOnDemandViewerPulse(channelId).catch(() => {});
}

export function touchOnDemandViewer(channelId) {
  const now = Date.now();
  let session = activity.get(channelId);
  if (!session) {
    session = { lastSeen: now, lastSegment: now, stopTimer: null };
    activity.set(channelId, session);
  } else {
    session.lastSeen = now;
  }
  pulseOnDemandViewer(channelId).catch(() => {});
}

export function noteOnDemandSegment(channelId) {
  const now = Date.now();
  let session = activity.get(channelId);
  if (!session) {
    session = { lastSeen: now, lastSegment: now, stopTimer: null };
    activity.set(channelId, session);
  } else {
    session.lastSegment = now;
    session.lastSeen = now;
  }
  pulseOnDemandViewer(channelId).catch(() => {});
  scheduleOnDemandIdleStop(channelId);
}

async function stopOnDemandIdleChannel(channelId) {
  const channel = await channelService.getChannelById(channelId);
  if (!channel?.on_demand || channel.status === 'stopped') {
    clearOnDemandSession(channelId);
    return;
  }

  if (['starting', 'restarting'].includes(channel.status)) {
    scheduleOnDemandIdleStop(channelId);
    return;
  }

  if (channel.status !== 'running') {
    clearOnDemandSession(channelId);
    return;
  }

  const viewerActive = await hasOnDemandViewerPulse(channelId);
  if (viewerActive) {
    scheduleOnDemandIdleStop(channelId);
    return;
  }

  const { enqueueStreamJob } = await import('./queue.service.js');
  await enqueueStreamJob(
    'stop-channel',
    channelId,
    { priority: 2, jobId: `on-demand-stop-${channelId}` },
    { options: { manual: false, reason: 'on_demand_idle' }, onDemand: true }
  );
  clearOnDemandSession(channelId);
  log.info({ channelId }, 'On-demand idle — stop queued (no viewers)');
}

export function scheduleOnDemandIdleStop(channelId) {
  let session = activity.get(channelId);
  if (!session) {
    session = { lastSeen: Date.now(), lastSegment: Date.now(), stopTimer: null };
    activity.set(channelId, session);
  }

  if (session.stopTimer) return;

  session.stopTimer = setInterval(async () => {
    try {
      const channel = await channelService.getChannelById(channelId);
      if (!channel?.on_demand || channel.status === 'stopped') {
        clearOnDemandSession(channelId);
        return;
      }

      if (['starting', 'restarting'].includes(channel.status)) {
        const age = Date.now() - new Date(channel.updated_at).getTime();
        if (age > STUCK_START_MS) {
          const { cancelChannelJobs } = await import('./queue.service.js');
          await cancelChannelJobs(channelId);
          await channelService.updateChannelStatus(channelId, 'stopped', {
            pid: null,
            last_error: 'انتهت مهلة الإقلاع — أعد المحاولة',
          });
          clearOnDemandSession(channelId);
        }
        return;
      }

      const viewerActive = await hasOnDemandViewerPulse(channelId);
      const localIdle = Date.now() - lastActivityMs(session) >= idleTimeoutMs();

      if (viewerActive || !localIdle) return;

      if (channel.status === 'running') {
        await stopOnDemandIdleChannel(channelId);
      }
    } catch (err) {
      log.warn({ channelId, err: err.message }, 'On-demand idle check failed');
    }
  }, idleCheckMs());

  if (typeof session.stopTimer.unref === 'function') {
    session.stopTimer.unref();
  }
}

export async function kickOnDemandStream(channelId) {
  let channel = await channelService.getChannelById(channelId);
  if (!channel) throw new Error('القناة غير موجودة');
  if (!channel.on_demand) {
    if (channel.status !== 'running') throw new Error('القناة غير نشطة');
    return channel;
  }

  touchOnDemandViewer(channelId);
  scheduleOnDemandIdleStop(channelId);

  if (channel.status === 'running') return channel;

  if (['starting', 'restarting'].includes(channel.status)) {
    const age = Date.now() - new Date(channel.updated_at).getTime();
    if (age < STUCK_STARTING_KICK_MS) {
      return channel;
    }
    // عالقة في الإقلاع — نُفرّغ المهام القديمة ونعيد المحاولة
    const { cancelChannelJobs } = await import('./queue.service.js');
    await cancelChannelJobs(channelId);
    await channelService.updateChannelStatus(channelId, 'stopped', {
      pid: null,
      last_error: 'إعادة محاولة الإقلاع',
    });
    channel = await channelService.getChannelById(channelId);
    log.warn({ channelId, ageMs: age }, 'On-demand stuck in starting — reset and retry');
  }

  const lastKick = kickCooldown.get(channelId);
  if (lastKick && Date.now() - lastKick < KICK_COOLDOWN_MS) {
    return channel;
  }
  kickCooldown.set(channelId, Date.now());

  await channelService.updateChannelStatus(channelId, 'starting');

  const { enqueueStreamJob } = await import('./queue.service.js');
  // إزالة مهمة إقلاع فاشلة/عالقة بنفس المعرّف قبل إنشاء واحدة جديدة
  try {
    const { getQueue } = await import('./queue.service.js');
    const queue = getQueue();
    const oldJob = await queue.getJob(`on-demand-start-${channelId}`);
    if (oldJob) {
      const state = await oldJob.getState();
      if (['completed', 'failed', 'delayed', 'waiting'].includes(state)) {
        await oldJob.remove().catch(() => {});
      }
    }
  } catch { /* ignore */ }

  await enqueueStreamJob(
    'start-channel',
    channelId,
    { priority: 1, jobId: `on-demand-start-${channelId}` },
    { onDemand: true }
  );

  log.info({ channelId, serverId: channel.server_id }, 'On-demand start queued');
  return channelService.getChannelById(channelId);
}

export async function ensureOnDemandStream(channelId, { waitTimeoutMs = 180000 } = {}) {
  const channel = await kickOnDemandStream(channelId);
  if (channel.status === 'running') return channel;

  const { waitForChannelRunning } = await import('./queue.service.js');
  await waitForChannelRunning(channelId, waitTimeoutMs, 400);
  const updated = await channelService.getChannelById(channelId);
  if (updated?.status !== 'running') {
    throw new Error(updated?.last_error || 'تعذّر تشغيل القناة');
  }
  scheduleOnDemandIdleStop(channelId);
  return updated;
}

/** إعادة تشغيل تلقائية عند انقطاع FFmpeg بينما المشاهد لا يزال نشطاً */
export async function recoverOnDemandIfViewersActive(channelId) {
  try {
    const viewerActive = await hasOnDemandViewerPulse(channelId);
    if (!viewerActive && !hasRecentLocalActivity(channelId)) return;
    await kickOnDemandStream(channelId);
  } catch (err) {
    log.warn({ channelId, err: err.message }, 'On-demand auto-recover failed');
  }
}

export async function noteOnDemandActivity(channelKey) {
  if (!channelKey) return;
  try {
    let channel = null;
    if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(channelKey))) {
      channel = await channelService.getChannelById(channelKey);
    } else {
      channel = await channelService.getChannelBySlug(channelKey);
    }
    if (!channel?.on_demand) return;
    touchOnDemandViewer(channel.id);
    scheduleOnDemandIdleStop(channel.id);
  } catch { /* ignore */ }
}
