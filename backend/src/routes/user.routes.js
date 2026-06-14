import * as authService from '../services/auth.service.js';
import { validate, createUserSchema, updateUserSchema, createTokenSchema, paginationSchema } from '../middleware/validate.js';
import { requireMinRole } from '../middleware/auth.js';

export default async function userRoutes(fastify) {
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', requireMinRole('admin'));

  fastify.get('/', async (request) => {
    const { page, limit } = paginationSchema.parse(request.query);
    return authService.listUsers({ page, limit });
  });

  fastify.post('/', {
    preHandler: [validate(createUserSchema)],
  }, async (request, reply) => {
    const user = await authService.createUser(request.body);
    await authService.logAudit(request.user.id, 'create', 'user', user.id, request.ip, request.headers['user-agent']);
    reply.status(201);
    return user;
  });

  fastify.put('/:id', {
    preHandler: [validate(updateUserSchema)],
  }, async (request, reply) => {
    const user = await authService.updateUser(request.params.id, request.body);
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return user;
  });

  fastify.delete('/:id', async (request, reply) => {
    if (request.params.id === request.user.id) {
      return reply.status(400).send({ error: 'لا يمكنك حذف حسابك الحالي — استخدم حساب مدير آخر' });
    }
    try {
      await authService.deleteUser(request.params.id);
    } catch (err) {
      return reply.status(err.statusCode || 500).send({ error: err.message || 'تعذّر حذف الحساب' });
    }
    await authService.logAudit(request.user.id, 'delete', 'user', request.params.id, request.ip, request.headers['user-agent']);
    return reply.status(204).send();
  });

  // API Tokens
  fastify.get('/:id/tokens', async (request) => {
    return authService.listApiTokens(request.params.id);
  });

  fastify.post('/:id/tokens', {
    preHandler: [validate(createTokenSchema)],
  }, async (request, reply) => {
    const result = await authService.createApiToken(
      request.params.id,
      request.body.name,
      request.body.scopes,
      request.body.expires_at
    );
    reply.status(201);
    return { ...result, message: 'Store this token securely. It will not be shown again.' };
  });

  fastify.delete('/:id/tokens/:tokenId', async (request, reply) => {
    await authService.revokeApiToken(request.params.tokenId, request.params.id);
    reply.status(204);
  });
}
