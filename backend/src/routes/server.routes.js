import * as serverService from '../services/server.service.js';
import * as provisionService from '../services/server-provision.service.js';
import { requireMinRole } from '../middleware/auth.js';
import { validate, createServerSchema, updateServerSchema, provisionServerSchema } from '../middleware/validate.js';

export default async function serverRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', async () => {
    const [servers, cluster] = await Promise.all([
      serverService.listServers(),
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
      return reply.status(400).send({ error: err.message });
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
      await serverService.deleteServer(request.params.id);
      reply.status(204);
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
