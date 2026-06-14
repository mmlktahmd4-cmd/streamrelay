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

/** Prevent duplicate failure handling while startStream is waiting for HLS */

const startupInProgress = new Set();

const FFMPEG_FATAL_RE = /HTTP error 40[0134]|Invalid data found|Connection refused|Protocol not found|Error opening input|Server returned 40[0134]|Unable to open resource|No such file or directory/i;

const FFMPEG_SLOW_RE = /Connection timed out|timed out|Operation timed out|Network unreachable|Network is unreachable/i;



const STREAMING_STATUSES = new Set(['running', 'starting', 'restarting']);



function canAutoRestart(channel) {

  if (!channel?.auto_restart) return false;
  if (channel.on_demand) return false;

  const max = config.streaming.maxRestartAttempts;

  // max = 0 يعني محاولات بلا حد (للقنوات الموثوقة فقط — اضبط MAX_RESTART_ATTEMPTS=0 يدوياً).
  // الافتراضي 10: بعدها تتوقف القناة الفاشلة نهائياً بدل حلقة إعادة تشغيل لا نهائية
  // ترفع حمل السيرفر وتجمّد اللوحة (مثل روابط محظورة جغرافياً أو منتهية).
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
  if (channel.on_demand) return;
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



function buildFFmpegArgs(channel, sourceOverride = null) {

  const sourceUrl = String(sourceOverride || channel.source_url || '').trim();

  const args = [

    '-hide_banner',

    '-loglevel', 'warning',

    '-stats_period', '1',

  ];



  // كشف تلقائي: أي رابط فيه .m3u8 هو HLS فعلياً حتى لو صُنّف http عند الاستيراد.
  const sourceLower = sourceUrl.toLowerCase();
  const rawType = channel.source_type || 'hls';
  const inputType = sourceLower.includes('.m3u8') ? 'hls' : rawType;

  // مهم جداً: لا نستخدم reconnect_at_eof أبداً.
  // كان يُستخدم لمصادر http، لكنه يسبب حلقة إعادة اتصال لحظية (0s) لا نهائية عند أي
  // مصدر يُرجع EOF بسرعة (رابط منتهٍ/خاطئ أو ليس بثاً مستمراً)، فلا يخرج فيديو أبداً
  // وتعلّق القناة حتى تنتهي مهلة HLS ثم تفشل بـ "HLS output not ready".
  // نكتفي بإعادة الاتصال عند أخطاء الشبكة الحقيقية فقط؛ وعندها EOF النظيف يُنهي
  // العملية فوراً فتفشل القناة بسرعة وتُجرَّب القناة الاحتياطية إن وُجدت.
  if (inputType === 'hls' || inputType === 'm3u' || inputType === 'http') {
    args.push(
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_on_network_error', '1',
      '-reconnect_on_http_error', '5xx,408,429',
      '-reconnect_delay_max', '5',
    );
  }



  if (['hls', 'http', 'm3u'].includes(inputType)) {

    args.push(
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
      '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-rw_timeout', '20000000',
      // متابعة إعادة التوجيه: روابط Xtream Codes (host:port/user/pass/id) كثيراً ما ترد 302
      // إلى ملف .ts أو .m3u8، ويجب أن يتبعها FFmpeg ويسمح بإعادة الطلبات.
      '-multiple_requests', '1',
    );

    // allowed_extensions خيار خاص بـ HLS demuxer فقط. كثير من روابط Xtream المصنّفة
    // m3u/hls هي فعلياً mpegts بلا امتداد، وعندها يختار FFmpeg مُفكّك mpegts فيرفض
    // الخيار بخطأ قاتل: "Option allowed_extensions not found". لذلك نطبّقه فقط عندما
    // يكون الرابط قائمة تشغيل .m3u8 حقيقية (حينها يُستخدم مُفكّك hls فعلاً).
    if (sourceLower.includes('.m3u8')) {
      args.push('-allowed_extensions', 'ALL');
    }

  } else if (inputType === 'rtmp') {

    args.push('-rw_timeout', '15000000');

  }



  args.push(
    '-thread_queue_size', '1024',
    '-analyzeduration', '10000000',
    '-probesize', '10000000',
    '-i', sourceUrl
  );

  args.push('-fflags', '+genpts+discardcorrupt');
  args.push('-max_muxing_queue_size', '2048');
  args.push('-avoid_negative_ts', 'make_zero');

  // live_start_index خيار خاص بـ HLS demuxer فقط. تطبيقه على بث mpegts مباشر
  // (وهو ما تعطيه كثير من روابط Xtream بدون امتداد) يربك الإدخال ويؤخر الإقلاع.
  if (inputType === 'hls') {
    args.push('-live_start_index', '-3');
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

        '-hls_list_size', '10',

        '-hls_delete_threshold', '4',

        '-hls_flags', 'delete_segments+omit_endlist+program_date_time+independent_segments+temp_file',

        '-hls_start_number_source', 'epoch',

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

export async function clearChannelMediaOutput(channel) {
  const { purgeLocalHlsCache } = await import('./hls-relay.service.js');
  await purgeLocalHlsCache(channel.id, channel.slug);
  if (channel.output_format === 'mpegts' && channel.slug) {
    try {
      await fs.rm(path.join(config.streaming.mpegtsDir, `${channel.slug}.ts`), { force: true });
    } catch { /* ignore */ }
  }
}

async function waitForHlsReady(channelId, procPid, timeoutMs) {
  if (timeoutMs <= 0) return true;

  const hlsDir = path.join(config.streaming.hlsDir, channelId);
  const manifest = path.join(hlsDir, 'index.m3u8');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!checkProcessAlive(procPid)) return false;

    try {
      const stat = await fs.stat(manifest);
      if (stat.size > 32) {
        const content = await fs.readFile(manifest, 'utf8');
        if (content.includes('#EXTM3U') && /\.ts|\.m4s/.test(content)) {
          return true;
        }
      }
    } catch { /* not ready yet */ }

    // إقلاع أسرع: بمجرد ظهور أول مقطع فعلي على القرص نعتبر البث بدأ،
    // حتى لو لم يُحدّث FFmpeg الـmanifest بعد. يحل بطء/تعثّر إقلاع بعض القنوات.
    try {
      const files = await fs.readdir(hlsDir);
      if (files.some((n) => n.endsWith('.ts') || n.endsWith('.m4s'))) {
        return true;
      }
    } catch { /* dir not created yet */ }

    // فحص كل 250ms (بدل 500ms) لكشف الجاهزية أسرع
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
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



export async function startStream(channelId, options = {}) {

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

  const purgeMedia = options.purgeMedia ?? (
    channel.output_format === 'hls'
      ? ['stopped', 'error', 'starting', 'restarting'].includes(channel.status)
      : (!channel.on_demand && ['stopped', 'error'].includes(channel.status))
  );

  if (purgeMedia) {
    await clearChannelMediaOutput(channel);
  }

  await ensureOutputDir(channel);

  await channelService.updateChannelStatus(channelId, 'starting');

  startupInProgress.add(channelId);

  let fatalError = null;
  let lastStderr = '';
  let eofLoopHits = 0;



  const args = buildFFmpegArgs(channel, options.sourceOverride || null);

  log.info({ channelId, slug: channel.slug, args: args.join(' ') }, 'Starting FFmpeg');



  const proc = spawn(config.streaming.ffmpegPath, args, {

    detached: false,

    stdio: ['ignore', 'pipe', 'pipe'],

  });



  activeProcesses.set(channelId, proc);



  proc.stderr.on('data', (data) => {
    handleFfmpegStderr(channelId, data);
    const msg = data.toString();
    if (msg.trim()) {
      lastStderr = msg.trim().slice(0, 300);
      log.debug({ channelId, msg: msg.trim().slice(0, 200) }, 'FFmpeg stderr');
    }
    if (msg && FFMPEG_FATAL_RE.test(msg)) {
      fatalError = msg.trim().slice(0, 500);
    } else if (/error=End of file|Will reconnect at \d+ in 0 second/i.test(msg)) {
      // مصدر يُغلق فوراً (End of file) ويعيد المحاولة بلا توقّف = رابط غير صالح/منتهٍ.
      // نعتبره فادحاً بعد عدة محاولات حتى تفشل القناة بسرعة بدل التعليق حتى نهاية المهلة.
      eofLoopHits += 1;
      if (!fatalError && eofLoopHits >= 3) {
        fatalError = 'رابط المصدر يُغلق فوراً (End of file) — الرابط منتهٍ/غير صالح أو ليس بثاً مباشراً';
      }
    } else if (!fatalError && msg && FFMPEG_SLOW_RE.test(msg)) {
      fatalError = `رابط المصدر لا يستجيب: ${msg.trim().slice(0, 200)}`;
    }
  });



  proc.on('error', async (err) => {

    log.error({ channelId, err }, 'FFmpeg process error');

    activeProcesses.delete(channelId);

    if (startupInProgress.has(channelId)) return;

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

    if (startupInProgress.has(channelId)) return;

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

    } else if (ch.on_demand && wasStreaming && !wasManualStop) {

      await channelService.updateChannelStatus(channelId, 'stopped', { pid: null, last_error: null });

      await channelService.logStreamEvent(channelId, 'warn', `On-demand stream ended (code ${code})`);

      setTimeout(() => {
        import('./on-demand.service.js').then(({ recoverOnDemandIfViewersActive }) => {
          recoverOnDemandIfViewersActive(channelId).catch(() => {});
        });
      }, 4000);

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



  try {

    await new Promise((resolve) => setTimeout(resolve, config.streaming.startupMinWaitMs));



    if (fatalError || !checkProcessAlive(proc.pid)) {

      proc.removeAllListeners('exit');

      proc.removeAllListeners('error');

      if (checkProcessAlive(proc.pid)) killProcessTree(proc.pid);

      activeProcesses.delete(channelId);

      const earlyDetail = lastStderr ? ` (${lastStderr.slice(0, 150)})` : '';
      const msg = fatalError || `FFmpeg فشل في الإقلاع — تحقق من رابط المصدر${earlyDetail}`;

      if (!options.triedBackup) {
        const chBackup = await channelService.getChannelById(channelId);
        const backup = String(chBackup?.backup_source_url || '').trim();
        const primary = String(options.sourceOverride || chBackup?.source_url || '').trim();
        if (backup && backup !== primary) {
          log.info({ channelId }, 'Primary source failed — trying backup');
          return startStream(channelId, {
            ...options,
            triedBackup: true,
            sourceOverride: backup,
            purgeMedia: true,
          });
        }
      }

      const ch = await channelService.getChannelById(channelId);

      if (ch && canAutoRestart(ch)) {

        await handleUnexpectedStop(channelId, msg, ch);

      } else {

        const failStatus = ch?.on_demand ? 'stopped' : 'error';

        await channelService.updateChannelStatus(channelId, failStatus, {

          last_error: ch?.on_demand ? null : msg,

          pid: null,

        });

        await channelService.logStreamEvent(channelId, ch?.on_demand ? 'warn' : 'error', msg);

      }

      throw new Error(msg);

    }



    if (channel.output_format === 'hls') {

      const hlsReady = await waitForHlsReady(

        channel.id,

        proc.pid,

        config.streaming.hlsReadyTimeoutMs

      );

      if (fatalError || !hlsReady || !checkProcessAlive(proc.pid)) {

        proc.removeAllListeners('exit');

        proc.removeAllListeners('error');

        if (checkProcessAlive(proc.pid)) killProcessTree(proc.pid);

        activeProcesses.delete(channelId);

        const hlsDetail = lastStderr ? ` (${lastStderr.slice(0, 150)})` : '';
        const msg = fatalError

          || (checkProcessAlive(proc.pid)
            ? `HLS output not ready — رابط المصدر لا يعمل أو البث متوقف${hlsDetail}`
            : `FFmpeg توقف قبل إنتاج HLS${hlsDetail}`);

        if (!options.triedBackup) {
          const chBackup = await channelService.getChannelById(channelId);
          const backup = String(chBackup?.backup_source_url || '').trim();
          const primary = String(options.sourceOverride || chBackup?.source_url || '').trim();
          if (backup && backup !== primary) {
            log.info({ channelId }, 'Primary source failed — trying backup');
            return startStream(channelId, {
              ...options,
              triedBackup: true,
              sourceOverride: backup,
              purgeMedia: true,
            });
          }
        }

        const ch = await channelService.getChannelById(channelId);

        if (ch && canAutoRestart(ch)) {

          await handleUnexpectedStop(channelId, msg, ch);

        } else {

          const failStatus = ch?.on_demand ? 'stopped' : 'error';

          await channelService.updateChannelStatus(channelId, failStatus, {

            last_error: ch?.on_demand ? null : msg,

            pid: null,

          });

          await channelService.logStreamEvent(channelId, ch?.on_demand ? 'warn' : 'error', msg);

        }

        throw new Error(msg);

      }

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

  } finally {

    startupInProgress.delete(channelId);

  }

}



export async function stopStream(channelId, options = {}) {

  const { forDelete = false, manual = true } = options;



  if (manual && !forDelete) {

    manuallyStopped.add(channelId);

  }



  const { cancelChannelJobs } = await import('./queue.service.js');

  await cancelChannelJobs(channelId);



  const channelForStatus = await channelService.getChannelById(channelId);

  if (!channelForStatus) {

    manuallyStopped.delete(channelId);

    log.warn({ channelId }, 'Stop skipped: channel not found');

    return { status: 'stopped' };

  }

  await channelService.updateChannelStatus(channelId, 'stopped', {

    pid: null,

    last_stopped: new Date(),

  });



  const skipPurge = forDelete || options.reason === 'on_demand_idle';

  const proc = activeProcesses.get(channelId);

  if (proc) {
    proc.removeAllListeners('exit');
    proc.removeAllListeners('error');
    killProcessTree(proc.pid);
    activeProcesses.delete(channelId);
    await stopBandwidthTracking(channelId);

    if (!skipPurge) {
      const channel = await channelService.getChannelById(channelId);
      if (channel) await clearChannelMediaOutput(channel);
    }

  } else {

    const channel = await channelService.getChannelById(channelId);

    if (channel?.pid && checkProcessAlive(channel.pid)) {

      killProcessTree(channel.pid);

    }

    if (channel && !skipPurge) {
      await clearChannelMediaOutput(channel);
    }

  }



  if (!forDelete) {

    await channelService.logStreamEvent(
      channelId,
      'info',
      options.reason === 'on_demand_idle' ? 'Stream stopped (on-demand idle)' : 'Stream stopped manually'
    );

    const { releaseChannelFromServer } = await import('./server.service.js');
    await releaseChannelFromServer(channelId);

  } else {

    manuallyStopped.delete(channelId);

  }



  return { status: 'stopped' };

}



export async function recoverStaleStream(channelId) {

  const channel = await channelService.getChannelById(channelId);

  if (!channel || channel.on_demand) return;

  const proc = activeProcesses.get(channelId);

  if (proc) {

    proc.removeAllListeners('exit');

    proc.removeAllListeners('error');

    killProcessTree(proc.pid);

    activeProcesses.delete(channelId);

    await stopBandwidthTracking(channelId);

  } else if (channel?.pid && checkProcessAlive(channel.pid)) {

    killProcessTree(channel.pid);

  }



  if (channel) {

    await channelService.updateChannelStatus(channelId, 'error', {

      pid: null,

      last_error: 'HLS output stale — restarting',

      failure_count: (channel.failure_count || 0) + 1,

    });

    await channelService.logStreamEvent(channelId, 'warn', 'HLS output stale — restarting stream');

    if (canAutoRestart(channel)) {

      await scheduleAutoRestart(channelId);

    }

  }

}



export async function restartStream(channelId) {

  const channel = await channelService.getChannelById(channelId);

  if (!channel) {

    log.warn({ channelId }, 'Restart skipped: channel not found');

    return { status: 'skipped', reason: 'channel_not_found' };

  }



  await channelService.updateChannelStatus(channelId, 'restarting');

  await stopStream(channelId, { manual: false });

  await new Promise((resolve) => setTimeout(resolve, 2000));



  try {

    const result = await startStream(channelId, { purgeMedia: false });

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


