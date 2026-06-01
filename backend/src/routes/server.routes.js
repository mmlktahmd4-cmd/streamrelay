import * as serverService from '../services/server.service.js';
import * as provisionService from '../services/server-provision.service.js';
import * as remoteUpdateService from '../services/server-remote-update.service.js';
import { requireMinRole } from '../middleware/auth.js';
import { validate, createServerSchema, updateServerSchema, provisionServerSchema, serverSshSchema } from '../middleware/validate.js';

export default async function serverRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', async (request) => {
    const includeInactive = request.query?.all === '1' || request.query?.include_inactive === '1';
    const [servers, cluster] = await Promise.all([
      serverService.listServers({ includeInactive }),
      serverService.getClusterSummary(),
    ]);
    return { servers, cluster };
  });

  fastify.get('/cluster', async () => serverService.getClusterSummary());

  fastify.post('/provision', {
    preHandler: [requireMinRole('admin'), validate(provisionServerSchema)],
  }, async (request, reply) => {
    try {
      const result = await provisionService.provisionRemoteServer(request.body);
      reply.status(201);
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: err.message,
        log: err.log || undefined,
      });
    }
  });

  fastify.post('/', {
    preHandler: [requireMinRole('admin'), validate(createServerSchema)],
  }, async (request, reply) => {
    try {
      const server = await serverService.createServer(request.body);
      reply.status(201);
      return server;
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  fastify.post('/sync-remotes', {
    preHandler: [requireMinRole('admin')],
  }, async (request, reply) => {
    try {
      return await remoteUpdateService.syncAllRemoteWorkers();
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  fastify.post('/:id/update-remote', {
    preHandler: [requireMinRole('admin')],
  }, async (request, reply) => {
    try {
      return await remoteUpdateService.updateRemoteServer(request.params.id);
    } catch (err) {
      return reply.status(400).send({ error: err.message, log: err.log });
    }
  });

  fastify.put('/:id/ssh', {
    preHandler: [requireMinRole('admin'), validate(serverSshSchema)],
  }, async (request, reply) => {
    try {
      const server = await remoteUpdateService.saveServerSshCredentials(
        request.params.id,
        request.body
      );
      return server;
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  fastify.post('/:id/suspend', {
    preHandler: [requireMinRole('admin')],
  }, async (request, reply) => {
    try {
      const result = await serverService.suspendServer(request.params.id);
      return result;
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  fastify.post('/:id/unsuspend', {
    preHandler: [requireMinRole('admin')],
  }, async (request, reply) => {
    try {
      const result = await serverService.unsuspendServer(request.params.id);
      return result;
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  fastify.put('/:id', {
    preHandler: [requireMinRole('admin'), validate(updateServerSchema)],
  }, async (request, reply) => {
    try {
      const server = await serverService.updateServer(request.params.id, request.body);
      if (!server) return reply.status(404).send({ error: 'Server not found' });
      return server;
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  fastify.delete('/:id', {
    preHandler: [requireMinRole('admin')],
  }, async (request, reply) => {
    try {
      const result = await serverService.deleteServer(request.params.id);
      return result;
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
