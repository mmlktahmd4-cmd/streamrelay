import { query } from '../db/pool.js';
import * as channelService from './channel.service.js';
import { checkChannelHealth } from './health.service.js';
import {
  getServerById,
  getLocalServer,
  isServerOnline,
  getInternalHlsBaseForServer,
  isChannelAssignedToLocalWorker,
} from './server.service.js';
import { probeStream, probeHlsManifest } from '../utils/metrics.js';
import { getActiveStreams } from './stream.service.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('channel-diagnostics');

const PROBE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function heartbeatAgeSec(server) {
  if (!server?.last_heartbeat) return null;
  return Math.round((Date.now() - new Date(server.last_heartbeat).getTime()) / 1000);
}

async function probeSourceUrl(url, sourceType) {
  if (!url || !String(url).trim()) {
    return { ok: false, error: 'لا يوجد رابط مصدر' };
  }

  const trimmed = String(url).trim();

  if (trimmed.startsWith('udp://')) {
    return { ok: true, skipped: true, note: 'UDP — لا يُفحص من اللوحة' };
  }

  if (sourceType === 'rtmp') {
    return { ok: true, skipped: true, note: 'RTMP — فحص محدود من اللوحة' };
  }

  try {
    new URL(trimmed);
  } catch {
    return { ok: false, error: 'صيغة الرابط غير صحيحة' };
  }

  const result = await probeStream(trimmed, 15000, PROBE_UA);
  return {
    ok: result.alive,
    url: trimmed,
    status: result.status || null,
    latency_ms: result.latency_ms ?? null,
    error: result.error || (result.alive ? null : `المصدر لا يستجيب (HTTP ${result.status || '—'})`),
  };
}

async function probeRemoteHls(channel, server) {
  const base = getInternalHlsBaseForServer(server).replace(/\/$/, '');
  const url = `${base}/${channel.id}/index.m3u8`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: '*/*', 'User-Agent': PROBE_UA },
    });
    const body = res.ok ? await res.text() : '';
    const isHls = body.includes('#EXTM3U');
    return {
      ok: res.ok && isHls,
      url,
      status: res.status,
      error: res.ok ? (isHls ? null : 'الملف ليس قائمة HLS') : `HLS غير متاح (HTTP ${res.status})`,
    };
  } catch (err) {
    return { ok: false, url, error: err.message || 'تعذّر الوصول لـ HLS على السيرفر' };
  }
}

function buildIssues(checks, channel) {
  const issues = [];

  if (checks.source && !checks.source.ok && !checks.source.skipped) {
    issues.push({
      code: 'source_down',
      severity: 'error',
      message: checks.source.error || 'رابط المصدر لا يعمل',
      fix: null,
    });
  }

  if (checks.worker && !checks.worker.online) {
    issues.push({
      code: 'worker_offline',
      severity: 'error',
      message: `السيرفر «${checks.worker.name}» غير متصل — حدّث السيرفر أو تحقق من worker`,
      fix: null,
    });
  }

  if (checks.worker?.full && channel.status !== 'stopped') {
    issues.push({
      code: 'worker_full',
      severity: 'warn',
      message: `السيرفر ممتلئ (${checks.worker.load}) — انقل قنوات أو زِد max_streams`,
      fix: null,
    });
  }

  if (['starting', 'restarting'].includes(channel.status)) {
    const age = checks.stuck_starting_sec || 0;
    if (age > 90) {
      issues.push({
        code: 'stuck_starting',
        severity: 'error',
        message: `عالقة في «جاري التشغيل» منذ ${age} ثانية`,
        fix: 'restart',
      });
    } else if (age > 0) {
      issues.push({
        code: 'starting',
        severity: 'info',
        message: `جاري الإقلاع (${age}ث) — انتظر أو أعد التشغيل`,
        fix: 'restart',
      });
    }
  }

  if (channel.status === 'error') {
    issues.push({
      code: 'channel_error',
      severity: 'error',
      message: channel.last_error || 'القناة في حالة خطأ',
      fix: checks.source?.ok ? 'restart' : null,
    });
  }

  if (['running', 'starting', 'restarting'].includes(channel.status) && checks.hls && !checks.hls.ok) {
    if (checks.hls.status === 429) {
      issues.push({
        code: 'hls_rate_limited',
        severity: 'error',
        message: 'طلبات HLS مرفوضة بسبب Rate Limit (HTTP 429) — حدّث اللوحة/worker لتعطيل limit على البث',
        fix: null,
      });
      return issues;
    }

    issues.push({
      code: 'hls_down',
      severity: 'error',
      message: checks.hls.error || 'لا يُنتَج بث HLS على السيرفر',
      fix: checks.source?.ok ? 'restart' : null,
    });
  }

  if (channel.status === 'running' && checks.process && checks.process.ok === false) {
    issues.push({
      code: 'process_dead',
      severity: 'error',
      message: 'عملية FFmpeg غير موجودة رغم أن الحالة «تعمل»',
      fix: 'restart',
    });
  }

  return issues;
}

export async function diagnoseChannel(channelId) {
  const channel = await channelService.getChannelById(channelId);
  if (!channel) throw new Error('القناة غير موجودة');

  const [source, backupSource] = await Promise.all([
    probeSourceUrl(channel.source_url, channel.source_type),
    channel.backup_source_url
      ? probeSourceUrl(channel.backup_source_url, channel.source_type)
      : Promise.resolve(null),
  ]);

  let worker = null;
  if (channel.server_id) {
    const server = await getServerById(channel.server_id);
    if (server) {
      worker = {
        id: server.id,
        name: server.name,
        hostname: server.hostname,
        online: isServerOnline(server),
        heartbeat_age_sec: heartbeatAgeSec(server),
        load: `${server.current_streams}/${server.max_streams}`,
        full: Number(server.current_streams) >= Number(server.max_streams),
        is_local: !!server.is_local,
        suspended: !!server.is_suspended,
      };
    }
  } else {
    const local = await getLocalServer();
    if (local) {
      worker = {
        id: local.id,
        name: local.name,
        hostname: local.hostname,
        online: isServerOnline(local),
        heartbeat_age_sec: heartbeatAgeSec(local),
        load: `${local.current_streams}/${local.max_streams}`,
        full: Number(local.current_streams) >= Number(local.max_streams),
        is_local: true,
        suspended: !!local.is_suspended,
      };
    }
  }

  if (worker?.suspended) {
    worker.online = false;
  }

  let hls = null;
  let processCheck = null;

  const onLocalWorker = await isChannelAssignedToLocalWorker(channel);

  if (onLocalWorker) {
    const health = await checkChannelHealth(channel);
    hls = {
      ok: !!health.checks.hls?.alive,
      age_ms: health.checks.hls?.age_ms ?? null,
      path: health.checks.hls?.path ?? null,
      error: health.checks.hls?.error ?? null,
      scope: 'local_disk',
    };
    const active = getActiveStreams().find((s) => s.channelId === channel.id);
    processCheck = {
      ok: !!health.checks.process?.alive,
      pid: channel.pid,
      in_memory: !!active?.alive,
      scope: 'local_worker',
    };
  } else if (channel.server_id) {
    const server = await getServerById(channel.server_id);
    if (server) {
      const remoteHls = await probeRemoteHls(channel, server);
      hls = {
        ok: remoteHls.ok,
        url: remoteHls.url,
        status: remoteHls.status,
        error: remoteHls.error,
        scope: 'remote_http',
      };
    }
    processCheck = {
      ok: null,
      pid: channel.pid,
      note: 'FFmpeg على سيرفر بعيد — يُقيَّم عبر HLS',
      scope: 'remote',
    };
  }

  const stuck_starting_sec = ['starting', 'restarting'].includes(channel.status)
    ? Math.round((Date.now() - new Date(channel.updated_at).getTime()) / 1000)
    : 0;

  const recentLogs = await channelService.getStreamLogs({ channelId: channel.id, limit: 6 });

  const checks = {
    source,
    backup_source: backupSource,
    worker,
    hls,
    process: processCheck,
    stuck_starting_sec,
    on_demand: !!channel.on_demand,
  };

  const issues = buildIssues(checks, channel);
  const hasError = issues.some((i) => i.severity === 'error');

  return {
    channel_id: channel.id,
    name: channel.name,
    slug: channel.slug,
    status: channel.status,
    last_error: channel.last_error,
    server_name: worker?.name || null,
    checked_at: new Date().toISOString(),
    ok: !hasError,
    checks,
    issues,
    recent_logs: recentLogs.map((row) => ({
      level: row.level,
      message: row.message,
      created_at: row.created_at,
    })),
    summary: hasError
      ? issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' · ')
      : (issues.length ? issues.map((i) => i.message).join(' · ') : 'سليمة'),
  };
}

async function resolveChannelIds({ ids, all }) {
  if (all) {
    const result = await query(
      `SELECT id FROM channels WHERE is_active = true ORDER BY sort_order, name`
    );
    return result.rows.map((r) => r.id);
  }
  return ids || [];
}

export async function diagnoseChannels({ ids, all }) {
  const channelIds = await resolveChannelIds({ ids, all });
  const channels = [];

  for (const id of channelIds) {
    try {
      channels.push(await diagnoseChannel(id));
    } catch (err) {
      channels.push({
        channel_id: id,
        ok: false,
        summary: err.message,
        issues: [{ code: 'diagnose_failed', severity: 'error', message: err.message, fix: null }],
      });
    }
  }

  return {
    total: channels.length,
    ok: channels.filter((c) => c.ok).length,
    failed: channels.filter((c) => !c.ok).length,
    channels,
  };
}

export async function fixChannel(channelId, { force = false } = {}) {
  const before = await diagnoseChannel(channelId);

  const blockers = before.issues.filter((i) =>
    i.severity === 'error' && !i.fix && !force
  );
  if (blockers.length > 0) {
    return {
      fixed: false,
      before,
      message: blockers[0].message,
      fixes_applied: [],
    };
  }

  const canFix = force || before.issues.some((i) => i.fix === 'restart');
  if (!canFix && before.ok) {
    return {
      fixed: true,
      before,
      after: before,
      message: 'لا توجد مشكلة تحتاج إصلاح',
      fixes_applied: [],
    };
  }

  const fixesApplied = [];
  const { cancelChannelJobs, runStreamJob } = await import('./queue.service.js');
  const channel = await channelService.getChannelById(channelId);

  await cancelChannelJobs(channelId);
  fixesApplied.push('إلغاء jobs المعلّقة');

  if (channel.status === 'starting' || channel.status === 'restarting') {
    await channelService.updateChannelStatus(channelId, 'stopped', { pid: null });
    fixesApplied.push('إعادة ضبط حالة «جاري التشغيل»');
  }

  try {
    await runStreamJob('purge-channel-media', channelId, {}, 60000);
    fixesApplied.push('مسح ملفات HLS القديمة');
  } catch (err) {
    log.warn({ channelId, err: err.message }, 'Purge during fix failed');
  }

  try {
    if (channel.on_demand) {
      const { clearOnDemandSession, ensureOnDemandStream } = await import('./on-demand.service.js');
      clearOnDemandSession(channelId);
      await ensureOnDemandStream(channelId, { waitTimeoutMs: 180000 });
      fixesApplied.push('تشغيل On Demand');
    } else {
      await runStreamJob('restart-channel', channelId, { purgeMedia: true }, 240000);
      fixesApplied.push('إعادة تشغيل البث');
    }
  } catch (err) {
    const after = await diagnoseChannel(channelId).catch(() => before);
    return {
      fixed: false,
      before,
      after,
      message: err.message || 'فشل الإصلاح',
      fixes_applied: fixesApplied,
    };
  }

  const after = await diagnoseChannel(channelId);
  return {
    fixed: after.ok,
    before,
    after,
    message: after.ok ? 'تم الإصلاح بنجاح' : after.summary,
    fixes_applied: fixesApplied,
  };
}

export async function fixChannels({ ids, all, force = false }) {
  const channelIds = await resolveChannelIds({ ids, all });
  const results = [];

  for (const id of channelIds) {
    results.push(await fixChannel(id, { force }));
  }

  return {
    total: results.length,
    fixed: results.filter((r) => r.fixed).length,
    failed: results.filter((r) => !r.fixed).length,
    results,
  };
}
