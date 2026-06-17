import * as channelService from '../services/channel.service.js';
import { runStreamJob } from '../services/queue.service.js';
import * as categoryService from '../services/category.service.js';
import { resolveHlsBaseForChannel, resolvePanelPlaybackBase, getServerById, getLocalServer } from '../services/server.service.js';
import { generateSignedUrl } from '../utils/crypto.js';
import { kickOnDemandStream, noteOnDemandActivity } from '../services/on-demand.service.js';
import { validate, createChannelSchema, updateChannelSchema, importM3USchema, importM3UUrlPreviewSchema, importM3USelectedSchema, paginationSchema, bulkUpdateChannelsSchema, bulkStreamActionSchema, bulkDeleteChannelsSchema, bulkChannelIdsSchema } from '../middleware/validate.js';
import * as channelDiagnostics from '../services/channel-diagnostics.service.js';
import { requireMinRole } from '../middleware/auth.js';

export default async function channelRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  // Categories (must be before /:id)
  fastify.get('/meta/categories', async () => {
    return categoryService.listCategoriesWithCounts();
  });

  fastify.post('/meta/categories', {
    preHandler: [requireMinRole('admin')],
  }, async (request, reply) => {
    const { name } = request.body;
    if (!name) return reply.status(400).send({ error: 'Name required' });
    const category = await channelService.createCategory(name);
    reply.status(201);
    return category;
  });

  // Import M3U playlist (Xtream / standard M3U)
  fastify.post('/import/m3u', {
    preHandler: [requireMinRole('operator'), validate(importM3USchema)],
  }, async (request) => {
    return channelService.importM3U(request.body.content, {
      categoryId: request.body.category_id,
      isPublic: request.body.is_public !== false,
      onDemand: !!request.body.on_demand,
    });
  });

  // معاينة قائمة M3U من رابط مباشر (Xtream get.php?type=m3u ...)
  fastify.post('/import/m3u/preview', {
    preHandler: [requireMinRole('operator'), validate(importM3UUrlPreviewSchema)],
  }, async (request, reply) => {
    try {
      return await channelService.previewM3UFromUrl(request.body.url);
    } catch (err) {
      return reply.status(400).send({ error: err.message || 'فشل تحميل القائمة' });
    }
  });

  // استيراد القنوات المحددة فقط (بعد المعاينة)
  fastify.post('/import/m3u/selected', {
    preHandler: [requireMinRole('operator'), validate(importM3USelectedSchema)],
  }, async (request, reply) => {
    try {
      return await channelService.importM3USelected(request.body.channels, {
        categoryId: request.body.category_id,
        isPublic: request.body.is_public !== false,
        onDemand: !!request.body.on_demand,
      });
    } catch (err) {
      return reply.status(400).send({ error: err.message || 'فشل الاستيراد' });
    }
  });

  // Bulk update channels (must be before /:id)
  fastify.post('/bulk-update', {
    preHandler: [requireMinRole('operator'), validate(bulkUpdateChannelsSchema)],
  }, async (request, reply) => {
    try {
      return await channelService.bulkUpdateChannels(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Bulk start / stop / restart (must be before /:id)
  fastify.post('/bulk-action', {
    preHandler: [requireMinRole('operator'), validate(bulkStreamActionSchema)],
  }, async (request, reply) => {
    try {
      return await channelService.bulkStreamAction(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Bulk delete channels (must be before /:id)
  fastify.post('/bulk-delete', {
    preHandler: [requireMinRole('operator'), validate(bulkDeleteChannelsSchema)],
  }, async (request, reply) => {
    try {
      return await channelService.bulkDeleteChannels(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // فحص تشخيصي للقنوات (must be before /:id)
  fastify.post('/bulk-diagnostics', {
    preHandler: [requireMinRole('operator'), validate(bulkChannelIdsSchema)],
  }, async (request, reply) => {
    try {
      return await channelDiagnostics.diagnoseChannels(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  fastify.post('/bulk-fix', {
    preHandler: [requireMinRole('operator'), validate(bulkChannelIdsSchema)],
  }, async (request, reply) => {
    try {
      return await channelDiagnostics.fixChannels(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Viewer playlist — local relay URLs only (must be before /:id)
  fastify.get('/playlist.m3u', async (request, reply) => {
    const publicOnly = request.user.role === 'viewer';
    const channels = await channelService.listRunningChannelsForPlaylist({ publicOnly });
    const ttl = 86400;

    const lines = ['#EXTM3U', '#EXTINF:-1,StreamRelay — Local Relay'];
    for (const ch of channels) {
      const hlsBase = await resolvePanelPlaybackBase(ch);
      const signed = generateSignedUrl(ch.id, ttl, hlsBase);
      lines.push(`#EXTINF:-1,${ch.name}`);
      lines.push(signed.url);
    }

    reply.header('Content-Type', 'audio/x-mpegurl');
    reply.header('Content-Disposition', 'attachment; filename="streamrelay-local.m3u"');
    return lines.join('\n');
  });

  // List channels
  fastify.get('/', async (request) => {
    const { page, limit } = paginationSchema.parse(request.query);
    const { status, category_id, search } = request.query;
    const result = await channelService.listChannels({
      page, limit, status, categoryId: category_id, search,
    });

    if (request.user.role === 'viewer') {
      const movies = await categoryService.listPublicMovies();
      const movieItems = movies.map((m) => channelService.sanitizeChannelForRole(m, 'viewer'));
      result.channels = [
        ...result.channels
          .filter((ch) => ch.is_public)
          .map((ch) => channelService.sanitizeChannelForRole({ ...ch, content_type: ch.content_type || 'live' }, 'viewer')),
        ...movieItems,
      ];
    } else {
      // المشرف/المشغّل: ندمج الأفلام المرفوعة لتظهر مع القنوات في لوحة الإدارة
      let movies = await categoryService.listAllMovies();
      if (category_id) movies = movies.filter((m) => m.category_id === category_id);
      if (search) {
        const q = String(search).toLowerCase();
        movies = movies.filter((m) =>
          (m.name || '').toLowerCase().includes(q) || (m.slug || '').toLowerCase().includes(q));
      }
      result.channels = [...result.channels, ...movies];
    }

    return result;
  });

  // Get signed playback URL (must be before /:id)
  fastify.get('/:id/playback-url', async (request, reply) => {
    let channel = await channelService.getChannelById(request.params.id);
    let isMovie = false;

    if (!channel) {
      const movie = await categoryService.getMovieById(request.params.id);
      if (!movie) return reply.status(404).send({ error: 'Channel not found' });
      channel = movie;
      isMovie = true;
    }

    if (request.user.role === 'viewer' && !channel.is_public) {
      return reply.status(403).send({ error: 'Channel not available' });
    }

    if (isMovie || channel.content_type === 'vod') {
      return {
        url: categoryService.getVodPlaybackUrl(channel),
        type: 'vod',
        relay: false,
      };
    }

    try {
      if (channel.on_demand) {
        channel = await kickOnDemandStream(channel.id);
      } else if (channel.status !== 'running') {
        return reply.status(409).send({ error: 'Channel is not running' });
      }
    } catch (err) {
      return reply.status(503).send({ error: err.message || 'تعذّر تشغيل القناة' });
    }

    if (channel.on_demand) {
      await noteOnDemandActivity(channel.id);
    }

    const ttl = parseInt(request.query.ttl, 10) || undefined;
    const directBase = await resolveHlsBaseForChannel(channel);
    const signed = generateSignedUrl(channel.id, ttl, directBase);
    const assignedServer = channel.server_id ? await getServerById(channel.server_id) : null;
    const local = await getLocalServer();
    const isRemote = !!(local && channel.server_id && channel.server_id !== local.id);
    const starting = channel.on_demand && channel.status !== 'running';

    return {
      ...signed,
      direct_url: signed.url,
      type: 'live',
      relay: isRemote,
      on_demand: !!channel.on_demand,
      starting,
      status: channel.status,
      stream_server: assignedServer?.name || null,
      stream_server_hostname: assignedServer?.hostname || null,
      note: starting
        ? (isRemote
          ? `جاري تشغيل القناة على «${assignedServer?.name || 'سيرفر البث'}» — انتظر ثوانٍ`
          : 'جاري تشغيل القناة — انتظر ثوانٍ')
        : (isRemote
          ? `البث من «${assignedServer?.name}» عبر اللوحة الرئيسية`
          : 'بث من السيرفر الرئيسي'),
      hls_base: directBase,
      direct_hls_base: directBase,
    };
  });

  fastify.get('/:id/diagnostics', {
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    try {
      return await channelDiagnostics.diagnoseChannel(request.params.id);
    } catch (err) {
      return reply.status(404).send({ error: err.message });
    }
  });

  fastify.post('/:id/fix', {
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    try {
      return await channelDiagnostics.fixChannel(request.params.id, {
        force: !!request.body?.force,
      });
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Get single channel
  fastify.get('/:id', async (request, reply) => {
    let channel = await channelService.getChannelById(request.params.id);
    if (!channel) {
      const movie = await categoryService.getMovieById(request.params.id);
      if (!movie) return reply.status(404).send({ error: 'Channel not found' });
      channel = {
        ...movie,
        content_type: 'vod',
        status: 'running',
      };
    }

    if (request.user.role === 'viewer') {
      if (!channel.is_public) return reply.status(403).send({ error: 'Channel not available' });
      return channelService.sanitizeChannelForRole(channel, 'viewer');
    }

    return channel;
  });

  // Create channel
  fastify.post('/', {
    preHandler: [requireMinRole('operator'), validate(createChannelSchema)],
  }, async (request, reply) => {
    try {
      const channel = await channelService.createChannel(request.body);
      if (channel.auto_restart !== false && !channel.on_demand) {
        const { scheduleAutoStart } = await import('../services/stream.service.js');
        await scheduleAutoStart(channel.id, { delay: 3000 });
      }
      reply.status(201);
      return channel;
    } catch (err) {
      if (err.message?.includes('already exists')) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  // Update channel
  fastify.put('/:id', {
    preHandler: [requireMinRole('operator'), validate(updateChannelSchema)],
  }, async (request, reply) => {
    const channel = await channelService.updateChannel(request.params.id, request.body);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    return channel;
  });

  // Delete channel
  fastify.delete('/:id', {
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    const channel = await channelService.getChannelById(request.params.id);
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });

    await channelService.stopChannelForDelete(request.params.id);
    await channelService.deleteChannel(request.params.id);
    return reply.status(204).send();
  });

  // Duplicate channel
  fastify.post('/:id/duplicate', {
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    try {
      const channel = await channelService.duplicateChannel(request.params.id);
      reply.status(201);
      return channel;
    } catch (err) {
      if (err.message === 'Channel not found') {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // Start stream
  fastify.post('/:id/start', {
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    try {
      const channel = await channelService.getChannelById(request.params.id);
      if (!channel) return reply.status(404).send({ error: 'Channel not found' });
      if (channel.on_demand) {
        const { ensureOnDemandStream } = await import('../services/on-demand.service.js');
        return await ensureOnDemandStream(request.params.id);
      }
      return await runStreamJob('start-channel', request.params.id);
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Stop stream
  fastify.post('/:id/stop', {
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    try {
      return await runStreamJob('stop-channel', request.params.id, { options: { manual: true } });
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Restart stream
  fastify.post('/:id/restart', {
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    try {
      return await runStreamJob('restart-channel', request.params.id);
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Stream logs for channel
  fastify.get('/:id/logs', async (request) => {
    const { page, limit } = paginationSchema.parse(request.query);
    return channelService.getStreamLogs({
      channelId: request.params.id,
      page,
      limit,
    });
  });
}
