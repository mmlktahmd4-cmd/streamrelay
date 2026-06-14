import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { query } from '../db/pool.js';
import { hashToken } from '../utils/crypto.js';

export async function findUserByUsername(username) {
  const result = await query(
    'SELECT * FROM users WHERE username = $1 AND is_active = true',
    [username]
  );
  return result.rows[0] || null;
}

export async function findUserRecordByUsername(username) {
  const result = await query(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
}

export async function findUserById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

export async function updateLastLogin(userId) {
  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [userId]);
}

/**
 * جلسات دخول المشاهد — يُسمح بعدد أجهزة يساوي max_connections.
 * عند تجاوز العدد، يُحذف أقدم جهاز تلقائياً (الأقدم يخرج).
 */
export async function rotateLoginSession(userId, maxConnections = 1) {
  const sessionId = randomUUID();
  const limit = Math.max(1, Number(maxConnections) || 1);

  const res = await query('SELECT login_session_ids FROM users WHERE id = $1', [userId]);
  const current = Array.isArray(res.rows[0]?.login_session_ids) ? res.rows[0].login_session_ids : [];
  // أضف الجلسة الجديدة واحتفظ بآخر `limit` جلسة فقط
  const next = [...current, sessionId].slice(-limit);

  await query(
    'UPDATE users SET login_session_ids = $1, login_session_id = $2 WHERE id = $3',
    [next, sessionId, userId]
  );
  return sessionId;
}

export async function isLoginSessionValid(userId, sessionId) {
  if (!userId || !sessionId) return false;
  const result = await query(
    `SELECT 1 FROM users
       WHERE id = $1 AND is_active = true
         AND ($2 = ANY(COALESCE(login_session_ids, '{}')) OR login_session_id = $2)`,
    [userId, sessionId]
  );
  return result.rows.length > 0;
}

export async function clearLoginSession(userId) {
  await query(
    `UPDATE users SET login_session_id = NULL, login_session_ids = '{}' WHERE id = $1`,
    [userId]
  );
}

export async function createUser({ username, password, full_name, role = 'viewer', max_connections, maxConnections, expires_at }) {
  const passwordHash = await hashPassword(password);
  let connections = max_connections ?? maxConnections ?? 1;
  if (!Number.isInteger(connections) || connections < 1) connections = 1;
  const ownerName = (typeof full_name === 'string' && full_name.trim()) ? full_name.trim() : null;
  const result = await query(
    `INSERT INTO users (username, password_hash, full_name, role, max_connections, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, username, full_name, role, is_active, max_connections, expires_at, created_at`,
    [username, passwordHash, ownerName, role, connections, expires_at || null]
  );
  return result.rows[0];
}

export async function listUsers({ page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const [users, count] = await Promise.all([
    query(
      `SELECT id, username, full_name, role, is_active, max_connections, expires_at, last_login, created_at
       FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
    query('SELECT COUNT(*) FROM users'),
  ]);
  return {
    users: users.rows,
    total: parseInt(count.rows[0].count, 10),
    page,
    limit,
  };
}

export async function updateUser(id, fields) {
  const existing = await findUserById(id);
  if (!existing) return null;

  // طبّع اسم صاحب الحساب: فارغ ← null
  if (Object.prototype.hasOwnProperty.call(fields, 'full_name')) {
    fields.full_name = (typeof fields.full_name === 'string' && fields.full_name.trim())
      ? fields.full_name.trim()
      : null;
  }

  // اضبط عدد الأجهزة (لا أقل من 1) — يُسمح للمشاهد بأكثر من جهاز الآن
  if (Object.prototype.hasOwnProperty.call(fields, 'max_connections')) {
    const n = Number(fields.max_connections);
    fields.max_connections = (Number.isInteger(n) && n >= 1) ? n : 1;
  }

  const allowed = ['full_name', 'role', 'is_active', 'max_connections', 'allowed_ips', 'expires_at'];
  const sets = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = $${idx++}`);
      values.push(value);
    }
  }

  if (fields.password) {
    sets.push(`password_hash = $${idx++}`);
    values.push(await hashPassword(fields.password));
  }

  if (sets.length === 0) return null;

  values.push(id);
  const result = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, username, full_name, role, is_active, expires_at, max_connections`,
    values
  );
  return result.rows[0] || null;
}

export async function deleteUser(id) {
  const target = await findUserById(id);
  if (!target) return;

  // يُسمح بحذف المدير، لكن يجب إبقاء مدير واحد على الأقل لتفادي قفل اللوحة
  if (target.role === 'admin') {
    const { rows } = await query("SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin'");
    if ((rows[0]?.c || 0) <= 1) {
      const err = new Error('لا يمكن حذف آخر حساب مدير — أنشئ مديراً آخر أولاً');
      err.statusCode = 400;
      throw err;
    }
  }

  await query('DELETE FROM users WHERE id = $1', [id]);
}

export async function createApiToken(userId, name, scopes = [], expiresAt = null) {
  const { generateApiToken } = await import('../utils/crypto.js');
  const { token, prefix, hash } = generateApiToken();
  await query(
    `INSERT INTO api_tokens (user_id, name, token_hash, token_prefix, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, name, hash, prefix, scopes, expiresAt]
  );
  return { token, prefix };
}

export async function validateApiToken(token) {
  const hash = hashToken(token);
  const result = await query(
    `SELECT t.*, u.id as user_id, u.username, u.role, u.is_active
     FROM api_tokens t JOIN users u ON t.user_id = u.id
     WHERE t.token_hash = $1 AND t.is_active = true AND u.is_active = true
     AND (t.expires_at IS NULL OR t.expires_at > NOW())`,
    [hash]
  );
  if (result.rows.length === 0) return null;

  await query('UPDATE api_tokens SET last_used = NOW() WHERE id = $1', [result.rows[0].id]);
  return result.rows[0];
}

export async function listApiTokens(userId) {
  const result = await query(
    `SELECT id, name, token_prefix, scopes, expires_at, last_used, is_active, created_at
     FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function revokeApiToken(tokenId, userId) {
  await query('UPDATE api_tokens SET is_active = false WHERE id = $1 AND user_id = $2', [tokenId, userId]);
}

export async function logAudit(userId, action, resource, resourceId, ip, userAgent, details = {}) {
  await query(
    `INSERT INTO audit_logs (user_id, action, resource, resource_id, ip_address, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, action, resource, resourceId, ip, userAgent, JSON.stringify(details)]
  );
}
