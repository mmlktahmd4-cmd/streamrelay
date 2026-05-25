import * as authService from '../services/auth.service.js';
import { touchOnlineUser } from '../services/online-presence.service.js';

const ROLE_HIERARCHY = { admin: 3, operator: 2, viewer: 1 };

export async function authenticate(request, reply) {
  try {
    const authHeader = request.headers.authorization;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);

      if (token.startsWith('sr_')) {
        const apiToken = await authService.validateApiToken(token);
        if (!apiToken) {
          return reply.status(401).send({ error: 'Invalid API token' });
        }
        request.user = {
          id: apiToken.user_id,
          username: apiToken.username,
          role: apiToken.role,
          scopes: apiToken.scopes,
          isApiToken: true,
        };
        touchOnlineUser(request.user, { ip: request.ip });
        return;
      }

      await request.jwtVerify();
      request.user = request.user;
      touchOnlineUser(request.user, { ip: request.ip });
    } else {
      return reply.status(401).send({ error: 'Authentication required' });
    }
  } catch (err) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Authentication required' });
    }
    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }
  };
}

export function requireMinRole(minRole) {
  return async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Authentication required' });
    }
    const userLevel = ROLE_HIERARCHY[request.user.role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] || 0;
    if (userLevel < requiredLevel) {
      return reply.status(403).send({ error: 'Insufficient permissions' });
    }
  };
}

export async function checkIpAccess(request, reply) {
  const clientIp = request.ip;
  const { query } = await import('../db/pool.js');

  const denyRules = await query(
    `SELECT ip_address FROM ip_rules WHERE rule_type = 'deny' AND is_active = true`
  );

  for (const rule of denyRules.rows) {
    if (clientIp === rule.ip_address) {
      return reply.status(403).send({ error: 'IP address blocked' });
    }
  }

  if (request.user?.allowed_ips?.length > 0) {
    const allowed = request.user.allowed_ips.some(
      (ip) => ip === clientIp || ip === clientIp.replace('::ffff:', '')
    );
    if (!allowed) {
      return reply.status(403).send({ error: 'IP not allowed for this user' });
    }
  }
}
