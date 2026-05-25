import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import path from 'path';
import fs from 'fs';
import { config } from './config/index.js';
import { logger, createChildLogger } from './utils/logger.js';
import { runMigrations } from './db/migrate.js';
import { authenticate } from './middleware/auth.js';
import { setupQueueProcessors } from './services/queue.service.js';
import { stopAllStreams } from './services/stream.service.js';
import { refreshPublicUrlCache, isOriginAllowed } from './services/public-url.service.js';

import authRoutes from './routes/auth.routes.js';
import channelRoutes from './routes/channel.routes.js';
import userRoutes from './routes/user.routes.js';
import systemRoutes from './routes/system.routes.js';
import mikrotikRoutes from './routes/mikrotik.routes.js';
import categoryRoutes from './routes/category.routes.js';

const log = createChildLogger('server');

async function buildApp() {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    requestTimeout: 30000,
  });

  // Allow DELETE requests with empty JSON body (axios default Content-Type)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      done(null, body?.length ? JSON.parse(body) : {});
    } catch (err) {
      done(err);
    }
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  // CORS — يسمح بعناوين الشبكة المحلية وIP جهاز البث من إعدادات الميكروتik
  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, isOriginAllowed(origin));
    },
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
  });

  // JWT
  await app.register(jwt, {
    secret: config.jwt.secret,
  });

  app.decorate('authenticate', authenticate);

  await app.register(multipart, {
    limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  });

  // Serve HLS segments in dev / without Nginx
  await app.register(fastifyStatic, {
    root: path.resolve(config.streaming.hlsDir),
    prefix: '/hls/',
    decorateReply: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.m3u8')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (filePath.endsWith('.ts')) {
        res.setHeader('Cache-Control', 'max-age=5');
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  });

  // Serve uploaded VOD files
  await app.register(fastifyStatic, {
    root: path.resolve(config.streaming.vodDir),
    prefix: '/vod/',
    decorateReply: false,
    setHeaders(res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');
    },
  });

  // Routes
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(channelRoutes, { prefix: '/api/channels' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(systemRoutes, { prefix: '/api' });
  await app.register(mikrotikRoutes, { prefix: '/api/mikrotik' });
  await app.register(categoryRoutes, { prefix: '/api/categories' });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    log.error({ err: error, url: request.url }, 'Request error');

    if (error.validation) {
      return reply.status(400).send({ error: 'Validation error', details: error.validation });
    }

    const statusCode = error.statusCode || 500;
    reply.status(statusCode).send({
      error: statusCode === 500 ? 'Internal server error' : error.message,
    });
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    log.info({ signal }, 'Shutting down gracefully');
    await stopAllStreams();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return app;
}

async function main() {
  try {
    fs.mkdirSync(config.streaming.vodDir, { recursive: true });
    await runMigrations();
    await refreshPublicUrlCache();

    if (config.serverRole !== 'api-only') {
      await setupQueueProcessors();
    }

    const app = await buildApp();
    await app.listen({ port: config.port, host: config.host });
    log.info({ port: config.port, role: config.serverRole }, 'StreamRelay API started');
  } catch (err) {
    log.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();
