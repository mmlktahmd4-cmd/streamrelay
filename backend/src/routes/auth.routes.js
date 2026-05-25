import * as authService from '../services/auth.service.js';
import { touchOnlineUser } from '../services/online-presence.service.js';

export default async function authRoutes(fastify) {
  fastify.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { username, password } = request.body;

    const user = await authService.findUserByUsername(username);
    if (!user || !(await authService.verifyPassword(password, user.password_hash))) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      return reply.status(403).send({ error: 'انتهت صلاحية الحساب — تواصل مع المسؤول' });
    }

    const accessToken = fastify.jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
    );

    const refreshToken = fastify.jwt.sign(
      { id: user.id, type: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
    );

    await authService.updateLastLogin(user.id);
    await authService.logAudit(user.id, 'login', 'user', user.id, request.ip, request.headers['user-agent']);
    touchOnlineUser(
      { id: user.id, username: user.username, role: user.role },
      { ip: request.ip }
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        expires_at: user.expires_at,
        max_connections: user.max_connections,
      },
    };
  });

  fastify.post('/refresh', async (request, reply) => {
    const { refresh_token } = request.body;
    if (!refresh_token) {
      return reply.status(400).send({ error: 'Refresh token required' });
    }

    try {
      const decoded = fastify.jwt.verify(refresh_token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      if (decoded.type !== 'refresh') {
        return reply.status(401).send({ error: 'Invalid refresh token' });
      }

      const user = await authService.findUserById(decoded.id);
      if (!user || !user.is_active) {
        return reply.status(401).send({ error: 'User not found or inactive' });
      }

      if (user.expires_at && new Date(user.expires_at) < new Date()) {
        return reply.status(403).send({ error: 'انتهت صلاحية الحساب' });
      }

      const accessToken = fastify.jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
      );

      return { access_token: accessToken };
    } catch {
      return reply.status(401).send({ error: 'Invalid refresh token' });
    }
  });

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request) => {
    const user = await authService.findUserById(request.user.id);
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      max_connections: user.max_connections,
      expires_at: user.expires_at,
      is_active: user.is_active,
      last_login: user.last_login,
      created_at: user.created_at,
    };
  });

  fastify.post('/presence', { preHandler: [fastify.authenticate] }, async (request) => {
    touchOnlineUser(request.user, { ip: request.ip });
    return { ok: true };
  });
}
