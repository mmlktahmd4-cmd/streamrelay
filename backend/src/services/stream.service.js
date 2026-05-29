import { spawn } from 'child_process';

import fs from 'fs/promises';

import path from 'path';

import { config } from '../config/index.js';

import { query } from '../db/pool.js';

import * as channelService from './channel.service.js';

import { createChildLogger } from '../utils/logger.js';

import { checkProcessAlive, killProcessTree } from '../utils/process.js';
import {
  startBandwidthTracking,
  stopBandwidthTracking,
  handleFfmpegStderr,
} from './bandwidth.service.js';



const log = createChildLogger('stream-engine');



const activeProcesses = new Map();

/** Channels stopped manually — skip auto-restart on FFmpeg exit */

const manuallyStopped = new Set();



const STREAMING_STATUSES = new Set(['running', 'starting', 'restarting']);



function canAutoRestart(channel) {

  if (!channel?.auto_restart) return false;

  const max = config.streaming.maxRestartAttempts;

  if (max === 0) return true;

  return (channel.failure_count || 0) < max;

}



/** Windows FFmpeg exit codes are unsigned 32-bit; PostgreSQL integer is signed. */

function normalizeExitCode(code) {

  if (code == null) return null;

  const n = Number(code);

  if (!Number.isFinite(n)) return null;

  if (n > 2147483647) return n - 4294967296;

  if (n < -2147483648) return -2147483648;

  return Math.trunc(n);

}



export async function scheduleAutoStart(channelId, { delay = null } = {}) {
  const channel = await channelService.getChannelById(channelId);
  if (!channel?.is_active || !canAutoRestart(channel)) return;
  if (activeProcesses.has(channelId)) return;

  const { getQueue } = await import('./queue.service.js');
  const queue = getQueue();
  const jobId = `auto-start-${channelId}`;

  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'delayed' || state === 'waiting' || state === 'active') {
        return;
      }
      await existing.remove();
    }
  } catch { /* ignore */ }

  const delayMs = delay ?? config.streaming.restartCooldown;

  const { enqueueStreamJob } = await import('./queue.service.js');
  await enqueueStreamJob('start-channel', channelId, {
    delay: delayMs,
    jobId,
  });

  log.info({ channelId, delayMs }, 'Auto-start scheduled');
}

export async function scheduleAutoRestart(channelId) {
  const channel = await channelService.getChannelById(channelId);
  if (!canAutoRestart(channel)) return;

  if (channel?.status === 'stopped' || channel?.status === 'error') {
    await scheduleAutoStart(channelId);
    return;
  }

  const { getQueue } = await import('./queue.service.js');

  const queue = getQueue();

  const jobId = `auto-restart-${channelId}`;



  try {

    const existing = await queue.getJob(jobId);

    if (existing) {

      const state = await existing.getState();

      if (state === 'delayed' || state === 'waiting' || state === 'active') {

        return;

      }

      await existing.remove();

    }

  } catch { /* ignore */ }



  const { enqueueStreamJob } = await import('./queue.service.js');
  await enqueueStreamJob('restart-channel', channelId, {
    delay: config.streaming.restartCooldown,
    jobId,
  });



  log.info({ channelId, delayMs: config.streaming.restartCooldown }, 'Auto-restart scheduled');

}



function buildFFmpegArgs(channel) {

  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-stats_period', '1',
    '-reconnect', '1',

    '-reconnect_streamed', '1',

    '-reconnect_delay_max', '5',

    '-timeout', '10000000',

  ];



  if (channel.source_type === 'udp') {

    args.push('-i', channel.source_url);

  } else if (channel.source_type === 'rtmp') {

    args.push('-i', channel.source_url);

  } else {

    args.push('-i', channel.source_url);

  }



  const profile = typeof channel.transcode_profile === 'string'

    ? JSON.parse(channel.transcode_profile)

    : channel.transcode_profile || {};



  if (channel.transcode_enabled) {

    args.push('-c:v', profile.video_codec || 'libx264');

    args.push('-c:a', profile.audio_codec || 'aac');

    if (profile.video_codec === 'libx264') {

      args.push('-preset', profile.preset || 'veryfast');

      args.push('-b:v', profile.video_bitrate || '2000k');

    }

  } else {

    args.push('-c', 'copy');

  }



  switch (channel.output_format) {

    case 'hls': {

      const hlsDir = path.join(config.streaming.hlsDir, channel.id);

      args.push(

        '-f', 'hls',

        '-hls_time', '4',

        '-hls_list_size', '6',

        '-hls_flags', 'delete_segments+append_list+omit_endlist',

        '-hls_segment_filename', path.join(hlsDir, 'seg_%03d.ts'),

        path.join(hlsDir, 'index.m3u8')

      );

      break;

    }

    case 'mpegts': {

      const tsPath = path.join(config.streaming.mpegtsDir, `${channel.slug}.ts`);

      args.push('-f', 'mpegts', tsPath);

      break;

    }

    case 'rtmp': {

      const rtmpUrl = channel.output_url || `${config.public.rtmpIngest}/${channel.slug}`;

      args.push('-f', 'flv', rtmpUrl);

      break;

    }

    case 'relay':

    default:

      args.push('-f', 'mpegts', 'pipe:1');

      break;

  }



  return args;

}



async function ensureOutputDir(channel) {

  if (channel.output_format === 'hls') {

    await fs.mkdir(path.join(config.streaming.hlsDir, channel.id), { recursive: true });

  }

  if (channel.output_format === 'mpegts') {

    await fs.mkdir(config.streaming.mpegtsDir, { recursive: true });

  }

}



async function handleUnexpectedStop(channelId, message, channel) {

  await channelService.updateChannelStatus(channelId, 'error', {

    last_error: message,

    pid: null,

    failure_count: (channel?.failure_count || 0) + 1,

  });

  await channelService.logStreamEvent(channelId, 'error', message);

  if (canAutoRestart(channel)) {
    await scheduleAutoRestart(channelId);
  }

}



export async function startStream(channelId) {

  const channel = await channelService.getChannelById(channelId);

  if (!channel) throw new Error('Channel not found');

  if (activeProcesses.has(channelId)) {

    log.warn({ channelId }, 'Stream already running');

    return { status: 'already_running', pid: activeProcesses.get(channelId).pid };

  }

  const { assertChannelAssignedToLocal, bindChannelToServer } = await import('./server.service.js');
  const localServer = await assertChannelAssignedToLocal(channel);

  if (activeProcesses.size >= localServer.max_streams) {

    throw new Error('Maximum concurrent streams reached on this node');

  }



  await ensureOutputDir(channel);

  await channelService.updateChannelStatus(channelId, 'starting');



  const args = buildFFmpegArgs(channel);

  log.info({ channelId, slug: channel.slug, args: args.join(' ') }, 'Starting FFmpeg');



  const proc = spawn(config.streaming.ffmpegPath, args, {

    detached: false,

    stdio: ['ignore', 'pipe', 'pipe'],

  });



  activeProcesses.set(channelId, proc);



  proc.stderr.on('data', (data) => {
    handleFfmpegStderr(channelId, data);
    const msg = data.toString().trim();
    if (msg) {
      log.debug({ channelId, msg }, 'FFmpeg stderr');
    }
  });



  proc.on('error', async (err) => {

    log.error({ channelId, err }, 'FFmpeg process error');

    activeProcesses.delete(channelId);

    const ch = await channelService.getChannelById(channelId);

    if (ch && !manuallyStopped.has(channelId) && canAutoRestart(ch)) {

      await handleUnexpectedStop(channelId, err.message, ch);

    } else {

      await channelService.updateChannelStatus(channelId, 'error', {

        last_error: err.message,

        pid: null,

      });

      await channelService.logStreamEvent(channelId, 'error', `Process error: ${err.message}`);

    }

  });



  proc.on('exit', async (code, signal) => {
    log.info({ channelId, code, signal }, 'FFmpeg exited');
    await stopBandwidthTracking(channelId);
    activeProcesses.delete(channelId);

    const wasManualStop = manuallyStopped.has(channelId);

    manuallyStopped.delete(channelId);



    const ch = await channelService.getChannelById(channelId);

    if (!ch) return;



    const wasStreaming = STREAMING_STATUSES.has(ch.status);

    const shouldRecover = !wasManualStop && wasStreaming && canAutoRestart(ch);



    if (shouldRecover) {

      await handleUnexpectedStop(

        channelId,

        `Process exited with code ${code}${signal ? ` signal ${signal}` : ''}`,

        ch

      );

    } else if (wasManualStop || ch.status === 'stopped') {

      await channelService.updateChannelStatus(channelId, 'stopped', { pid: null });

    }



    try {

      await query(

        `UPDATE stream_sessions SET stopped_at = NOW(), exit_code = $1

         WHERE channel_id = $2 AND stopped_at IS NULL`,

        [normalizeExitCode(code), channelId]

      );

    } catch (err) {

      log.warn({ channelId, code, err: err.message }, 'Failed to record stream session exit code');

    }

  });



  await new Promise((resolve) => setTimeout(resolve, config.streaming.restartCooldown));



  if (!checkProcessAlive(proc.pid)) {

    activeProcesses.delete(channelId);

    const ch = await channelService.getChannelById(channelId);

    if (ch && canAutoRestart(ch)) {

      await handleUnexpectedStop(channelId, 'FFmpeg failed to start', ch);

    } else {

      await channelService.updateChannelStatus(channelId, 'error', {

        last_error: 'FFmpeg failed to start',

        pid: null,

      });

    }

    throw new Error('FFmpeg failed to start');

  }



  await channelService.updateChannelStatus(channelId, 'running', {

    pid: proc.pid,

    last_started: new Date(),

    failure_count: 0,

    last_error: null,

  });

  await bindChannelToServer(channelId, localServer, channel.slug);

  await query(

    `INSERT INTO stream_sessions (channel_id, server_id, pid) VALUES ($1, $2, $3)`,

    [channelId, localServer.id, proc.pid]

  );



  await channelService.logStreamEvent(channelId, 'info', `Stream started PID=${proc.pid}`);

  startBandwidthTracking(channelId, proc.pid, channel.id, channel.name, channel.slug);

  return { status: 'running', pid: proc.pid };

}



export async function stopStream(channelId, options = {}) {

  const { forDelete = false, manual = true } = options;



  if (manual && !forDelete) {

    manuallyStopped.add(channelId);

  }



  const { cancelChannelJobs } = await import('./queue.service.js');

  await cancelChannelJobs(channelId);



  if (!forDelete) {

    const channel = await channelService.getChannelById(channelId);

    if (!channel) {

      manuallyStopped.delete(channelId);

      log.warn({ channelId }, 'Stop skipped: channel not found');

      return { status: 'stopped' };

    }

    await channelService.updateChannelStatus(channelId, 'stopped', {

      pid: null,

      last_stopped: new Date(),

    });

  }



  const proc = activeProcesses.get(channelId);

  if (proc) {
    proc.removeAllListeners('exit');
    proc.removeAllListeners('error');
    killProcessTree(proc.pid);
    activeProcesses.delete(channelId);
    await stopBandwidthTracking(channelId);

  } else {

    const channel = await channelService.getChannelById(channelId);

    if (channel?.pid && checkProcessAlive(channel.pid)) {

      killProcessTree(channel.pid);

    }

  }



  if (!forDelete) {

    await channelService.logStreamEvent(channelId, 'info', 'Stream stopped manually');

    const { releaseChannelFromServer } = await import('./server.service.js');
    await releaseChannelFromServer(channelId);

  } else {

    manuallyStopped.delete(channelId);

  }



  return { status: 'stopped' };

}



export async function restartStream(channelId) {

  const channel = await channelService.getChannelById(channelId);

  if (!channel) {

    log.warn({ channelId }, 'Restart skipped: channel not found');

    return { status: 'skipped', reason: 'channel_not_found' };

  }



  await channelService.updateChannelStatus(channelId, 'restarting');

  await stopStream(channelId, { manual: false });

  await new Promise((resolve) => setTimeout(resolve, config.streaming.restartCooldown));



  try {

    const result = await startStream(channelId);

    const updated = await channelService.getChannelById(channelId);

    if (updated?.status === 'running') {

      await channelService.updateChannelStatus(channelId, 'running', {

        restart_count: (updated.restart_count || 0) + 1,

      });

    }

    return result;

  } catch (err) {

    log.warn({ channelId, err: err.message }, 'Restart attempt failed');

    await scheduleAutoRestart(channelId);

    return { status: 'error', error: err.message };

  }

}



export function getActiveStreams() {

  const streams = [];

  for (const [channelId, proc] of activeProcesses) {

    streams.push({

      channelId,

      pid: proc.pid,

      alive: checkProcessAlive(proc.pid),

    });

  }

  return streams;

}



export function getActiveCount() {

  return activeProcesses.size;

}



export function wasManuallyStopped(channelId) {

  return manuallyStopped.has(channelId);

}



export async function stopAllStreams() {

  const ids = [...activeProcesses.keys()];

  await Promise.all(ids.map((id) => stopStream(id)));

}


