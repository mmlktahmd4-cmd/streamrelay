import { getSystemMetrics } from '../utils/metrics.js';
import { getHealthSummary } from '../services/health.service.js';
import * as channelService from '../services/channel.service.js';
import * as serverRestart from '../services/server-restart.service.js';
import { getPublicUrls } from '../services/public-url.service.js';
import { getOnlineViewersCount, getOnlineViewers } from '../services/online-presence.service.js';
import { getSiteConfig, saveSiteConfig } from '../services/site-config.service.js';
import { getBranding, saveBranding } from '../services/branding.service.js';
import { getStreamingConfig, saveStreamingConfig } from '../services/streaming-config.service.js';
import { getClusterSummary } from '../services/server.service.js';
import { getBandwidthStats } from '../services/bandwidth.service.js';
import { getServerIpConfig, applyServerIp } from '../services/server-ip.service.js';
import { getUpdateStatus, triggerSelfUpdate, triggerSelfRollback } from '../services/self-update.service.js';
import { requireMinRole } from '../middleware/auth.js';
import { validate, siteConfigSchema, brandingSettingsSchema, serverIpApplySchema } from '../middleware/validate.js';
import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import fs from 'fs';
import path from 'path';

// مسار ملف تطبيق الأندرويد المحلي (يُنزّله سكربت التثبيت/التحديث من إصدار GitHub)
const APP_DIR = path.join(process.env.STREAMRELAY_INSTALL_DIR || '/opt/streamrelay', 'public', 'app');
const APK_PATH = path.join(APP_DIR, 'StreamRelay.apk');

export default async function systemRoutes(fastify) {
  // Public health check (outside auth hook)
  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'streamrelay-api',
    version: '1.0.0',
    server_id: config.serverId,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));

  fastify.get('/branding', async () => getBranding());

  // معلومات تطبيق الأندرويد (عام — تستخدمه صفحة المشاهدة لإظهار زر التحميل)
  fastify.get('/app/info', async () => {
    try {
      const st = fs.statSync(APK_PATH);
      return {
        available: true,
        size: st.size,
        filename: 'StreamRelay.apk',
        updated_at: st.mtime.toISOString(),
      };
    } catch {
      return { available: false };
    }
  });

  // تنزيل تطبيق الأندرويد (عام)
  fastify.get('/app/download', async (request, reply) => {
    let st;
    try {
      st = fs.statSync(APK_PATH);
    } catch {
      return reply.status(404).send({ error: 'تطبيق الأندرويد غير متوفر بعد على هذا السيرفر' });
    }
    reply.header('Content-Type', 'application/vnd.android.package-archive');
    reply.header('Content-Disposition', 'attachment; filename="StreamRelay.apk"');
    reply.header('Content-Length', st.size);
    reply.header('Cache-Control', 'no-cache');
    return reply.send(fs.createReadStream(APK_PATH));
  });

  await fastify.register(async function protectedSystemRoutes(protectedRoutes) {
    protectedRoutes.addHook('preHandler', fastify.authenticate);

    // System metrics
    protectedRoutes.get('/metrics', async () => getSystemMetrics());

    // Stream health summary
    protectedRoutes.get('/health/streams', async () => getHealthSummary());

    // Active streams
    protectedRoutes.get('/streams/active', async () => {
      const channels = await channelService.getRunningChannels();
      return {
        count: channels.length,
        streams: channels.map((channel) => ({
          channelId: channel.id,
          slug: channel.slug,
          status: channel.status,
          pid: channel.pid,
        })),
        max: config.streaming.maxConcurrent,
      };
    });

    // Bandwidth stats — خفيف (يقرأ من Redis على worker) — للتحديث السريع في اللوحة
    protectedRoutes.get('/bandwidth', async () => getBandwidthStats());

    // Dashboard stats
    protectedRoutes.get('/dashboard', async () => {
      const [channels, users, logs, runningChannels] = await Promise.all([
        query(`SELECT status, COUNT(*) as count FROM channels WHERE is_active = true GROUP BY status`),
        query('SELECT COUNT(*) as count FROM users WHERE is_active = true'),
        query(`SELECT COUNT(*) as count FROM stream_logs WHERE created_at > NOW() - INTERVAL '24 hours'`),
        channelService.getRunningChannels(),
      ]);

      const channelStats = {};
      for (const row of channels.rows) {
        channelStats[row.status] = parseInt(row.count, 10);
      }

      const bandwidth = await getBandwidthStats(runningChannels);
      const [onlineCount, onlineList] = await Promise.all([
        getOnlineViewersCount(),
        getOnlineViewers(),
      ]);

      return {
        channels: channelStats,
        total_channels: Object.values(channelStats).reduce((a, b) => a + b, 0),
        active_users: parseInt(users.rows[0].count, 10),
        online_users: onlineCount,
        online_users_list: onlineList.map((u) => ({
          username: u.username,
          role: u.role,
          ip: u.ip,
          last_seen: new Date(u.lastSeen).toISOString(),
        })),
        logs_24h: parseInt(logs.rows[0].count, 10),
        active_streams: (channelStats.running || 0) + (channelStats.starting || 0) + (channelStats.restarting || 0),
        bandwidth,
        system: getSystemMetrics(),
        network: getPublicUrls(),
        cluster: await getClusterSummary(),
      };
    });

    // تحديث IP الشبكة وروابط القنوات (عند فتح اللوحة)
    protectedRoutes.post('/refresh-network', {
      preHandler: [requireMinRole('operator')],
    }, async () => serverRestart.refreshNetworkUrls());

    // إعادة تشغيل السيرفر + تحديث IP
    protectedRoutes.post('/restart', {
      preHandler: [requireMinRole('admin')],
    }, async () => serverRestart.restartServer());

    protectedRoutes.get('/network-urls', {
      preHandler: [requireMinRole('operator')],
    }, async () => serverRestart.getNetworkStatus());

    protectedRoutes.get('/server-ip', {
      preHandler: [requireMinRole('admin')],
    }, async () => getServerIpConfig());

    protectedRoutes.put('/server-ip', {
      preHandler: [requireMinRole('admin'), validate(serverIpApplySchema)],
    }, async (request, reply) => {
      try {
        return await applyServerIp(request.body);
      } catch (err) {
        return reply.status(400).send({ error: err.message || 'تعذّر تطبيق IP السيرفر' });
      }
    });

    // تحديث اللوحة من GitHub بضغطة (git pull + إعادة بناء) — يُنفّذ على الجهاز عبر وحدة systemd
    protectedRoutes.get('/self-update', {
      preHandler: [requireMinRole('admin')],
    }, async (request) => getUpdateStatus({
      force: request.query?.force === '1' || request.query?.force === 'true',
    }));

    protectedRoutes.post('/self-update', {
      preHandler: [requireMinRole('admin')],
    }, async (request, reply) => {
      try {
        return triggerSelfUpdate(request.body || {});
      } catch (err) {
        return reply.status(400).send({ error: err.message || 'تعذّر بدء تحديث اللوحة' });
      }
    });

    protectedRoutes.post('/self-update/rollback', {
      preHandler: [requireMinRole('admin')],
    }, async (request, reply) => {
      try {
        return triggerSelfRollback();
      } catch (err) {
        return reply.status(400).send({ error: err.message || 'تعذّر بدء الرجوع للنسخة السابقة' });
      }
    });

    protectedRoutes.get('/site-config', {
      preHandler: [requireMinRole('operator')],
    }, async () => getSiteConfig());

    protectedRoutes.put('/site-config', {
      preHandler: [requireMinRole('admin'), validate(siteConfigSchema)],
    }, async (request, reply) => {
      try {
        return await saveSiteConfig(request.body);
      } catch (err) {
        return reply.status(400).send({ error: err.message || 'تعذّر حفظ إعدادات الدومين' });
      }
    });

    protectedRoutes.get('/settings/branding', {
      preHandler: [requireMinRole('admin')],
    }, async () => getBranding());

    protectedRoutes.put('/settings/branding', {
      preHandler: [requireMinRole('admin'), validate(brandingSettingsSchema)],
    }, async (request) => saveBranding(request.body));

    // إعدادات البث (البث متعدد الجودات ABR) — قراءة/تحديث بزرّ من اللوحة
    protectedRoutes.get('/settings/streaming', {
      preHandler: [requireMinRole('operator')],
    }, async () => getStreamingConfig());

    protectedRoutes.put('/settings/streaming', {
      preHandler: [requireMinRole('admin')],
    }, async (request, reply) => {
      try {
        return await saveStreamingConfig(request.body || {});
      } catch (err) {
        return reply.status(400).send({ error: err.message || 'تعذّر حفظ إعدادات البث' });
      }
    });

    // Logs
    protectedRoutes.get('/logs', async (request) => {
      const { page = 1, limit = 50, level, channel_id } = request.query;
      return channelService.getStreamLogs({
        channelId: channel_id,
        level,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
      });
    });

    // Audit logs
    protectedRoutes.get('/audit', async (request) => {
      const page = parseInt(request.query.page || '1', 10);
      const limit = parseInt(request.query.limit || '50', 10);
      const offset = (page - 1) * limit;

      const result = await query(
        `SELECT al.*, u.username
         FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id
         ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return result.rows;
    });

    // Settings
    protectedRoutes.get('/settings', async () => {
      const result = await query('SELECT key, value FROM settings');
      const settings = {};
      for (const row of result.rows) {
        settings[row.key] = row.value;
      }
      return settings;
    });
  });
}
