import * as authService from '../services/auth.service.js';
import { touchOnlineUser } from '../services/online-presence.service.js';

function loginError(reply, statusCode, error, reason) {
  return reply.status(statusCode).send({ error, reason });
}

export default async function authRoutes(fastify) {
  fastify.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const username = typeof request.body?.username === 'string' ? request.body.username.trim() : '';
    const password = request.body?.password ?? '';

    if (!username || !password) {
      return loginError(
        reply,
        400,
        'يرجى إدخال اسم المستخدم وكلمة المرور',
        'missing_fields'
      );
    }

    if (username.length < 3 || username.length > 64) {
      return loginError(
        reply,
        400,
        'اسم المستخدم يجب أن يكون بين 3 و 64 حرفاً',
        'invalid_username'
      );
    }

    if (password.length < 6 || password.length > 128) {
      return loginError(
        reply,
        400,
        'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
        'invalid_password'
      );
    }

    const user = await authService.findUserRecordByUsername(username);
    if (!user) {
      return loginError(
        reply,
        401,
        'اسم المستخدم غير موجود — تحقق من الإملاء',
        'user_not_found'
      );
    }

    if (!user.is_active) {
      return loginError(
        reply,
        403,
        'هذا الحساب معطّل — تواصل مع المسؤول',
        'account_disabled'
      );
    }

    if (!(await authService.verifyPassword(password, user.password_hash))) {
      return loginError(
        reply,
        401,
        'كلمة المرور غير صحيحة — راجع بيانات التثبيت على السيرفر أو اطلب إعادة تعيينها',
        'wrong_password'
      );
    }

    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      return loginError(
        reply,
        403,
        'انتهت صلاحية الحساب — تواصل مع المسؤول',
        'account_expired'
      );
    }

    let sessionId = null;
    if (user.role === 'viewer') {
      sessionId = await authService.rotateLoginSession(user.id);
    }

    const accessPayload = { id: user.id, username: user.username, role: user.role };
    if (sessionId) accessPayload.sid = sessionId;

    const accessToken = fastify.jwt.sign(
      accessPayload,
      { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
    );

    const refreshPayload = { id: user.id, type: 'refresh' };
    if (sessionId) refreshPayload.sid = sessionId;

    const refreshToken = fastify.jwt.sign(
      refreshPayload,
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

      if (user.role === 'viewer') {
        if (!decoded.sid || !(await authService.isLoginSessionValid(user.id, decoded.sid))) {
          return reply.status(401).send({
            error: 'تم تسجيل الدخول من جهاز آخر — سجّل الدخول مجدداً',
            reason: 'session_replaced',
          });
        }
      }

      const accessPayload = { id: user.id, username: user.username, role: user.role };
      if (decoded.sid) accessPayload.sid = decoded.sid;

      const accessToken = fastify.jwt.sign(
        accessPayload,
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
