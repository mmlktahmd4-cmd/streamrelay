import * as mikrotikService from '../services/mikrotik.service.js';
import { requireMinRole } from '../middleware/auth.js';
import { validate, mikrotikConfigSchema, ipRuleSchema } from '../middleware/validate.js';

export default async function mikrotikRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requireMinRole('admin'));

  fastify.get('/info', async () => mikrotikService.getServerInfo());

  fastify.get('/config', async () => mikrotikService.getMikrotikConfig());

  fastify.put('/config', {
    preHandler: [validate(mikrotikConfigSchema)],
  }, async (request, reply) => {
    try {
      return await mikrotikService.saveMikrotikConfig(request.body);
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  fastify.get('/scripts', async () => mikrotikService.generateScripts());

  fastify.get('/ip-rules', async () => mikrotikService.listIpRules());

  fastify.post('/ip-rules', {
    preHandler: [validate(ipRuleSchema)],
  }, async (request, reply) => {
    const rule = await mikrotikService.createIpRule(request.body);
    reply.status(201);
    return rule;
  });

  fastify.delete('/ip-rules/:id', async (request, reply) => {
    await mikrotikService.deleteIpRule(request.params.id);
    reply.status(204);
  });
}
