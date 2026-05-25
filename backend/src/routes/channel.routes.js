import * as channelService from '../services/channel.service.js';
import * as streamService from '../services/stream.service.js';
import * as categoryService from '../services/category.service.js';
import { generateSignedUrl } from '../utils/crypto.js';
import { validate, createChannelSchema, updateChannelSchema, importM3USchema, paginationSchema } from '../middleware/validate.js';
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
    });
  });

  // Viewer playlist — local relay URLs only (must be before /:id)
  fastify.get('/playlist.m3u', async (request, reply) => {
    const publicOnly = request.user.role === 'viewer';
    const channels = await channelService.listRunningChannelsForPlaylist({ publicOnly });
    const ttl = 86400;

    const lines = ['#EXTM3U', '#EXTINF:-1,StreamRelay — Local Relay'];
    for (const ch of channels) {
      const signed = generateSignedUrl(ch.slug, ttl);
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

    if (channel.status !== 'running') {
      return reply.status(409).send({ error: 'Channel is not running' });
    }

    const ttl = parseInt(request.query.ttl, 10) || undefined;
    return {
      ...generateSignedUrl(channel.slug, ttl),
      type: 'live',
      relay: true,
      note: 'Local relay URL — viewers watch from your server, not the external source',
    };
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
    await streamService.stopStream(request.params.id, { forDelete: true });
    await channelService.deleteChannel(request.params.id);
    reply.status(204);
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
      return await streamService.startStream(request.params.id);
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // Stop stream
  fastify.post('/:id/stop', {
    preHandler: [requireMinRole('operator')],
  }, async (request) => {
    return streamService.stopStream(request.params.id);
  });

  // Restart stream
  fastify.post('/:id/restart', {
    preHandler: [requireMinRole('operator')],
  }, async (request, reply) => {
    try {
      return await streamService.restartStream(request.params.id);
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
