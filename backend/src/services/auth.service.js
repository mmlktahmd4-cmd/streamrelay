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

/** جلسة دخول واحدة للمشاهد — جهاز جديد يلغي الجلسة السابقة */
export async function rotateLoginSession(userId) {
  const sessionId = randomUUID();
  await query('UPDATE users SET login_session_id = $1 WHERE id = $2', [sessionId, userId]);
  return sessionId;
}

export async function isLoginSessionValid(userId, sessionId) {
  if (!userId || !sessionId) return false;
  const result = await query(
    'SELECT 1 FROM users WHERE id = $1 AND login_session_id = $2 AND is_active = true',
    [userId, sessionId]
  );
  return result.rows.length > 0;
}

export async function clearLoginSession(userId) {
  await query('UPDATE users SET login_session_id = NULL WHERE id = $1', [userId]);
}

export async function createUser({ username, password, role = 'viewer', max_connections, maxConnections, expires_at }) {
  const passwordHash = await hashPassword(password);
  let connections = max_connections ?? maxConnections ?? 1;
  if (role === 'viewer') connections = 1;
  const result = await query(
    `INSERT INTO users (username, password_hash, role, max_connections, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, role, is_active, max_connections, expires_at, created_at`,
    [username, passwordHash, role, connections, expires_at || null]
  );
  return result.rows[0];
}

export async function listUsers({ page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const [users, count] = await Promise.all([
    query(
      `SELECT id, username, role, is_active, max_connections, expires_at, last_login, created_at
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

  const role = fields.role ?? existing.role;
  if (role === 'viewer') {
    fields.max_connections = 1;
  }

  const allowed = ['role', 'is_active', 'max_connections', 'allowed_ips', 'expires_at'];
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
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, username, role, is_active, expires_at, max_connections`,
    values
  );
  return result.rows[0] || null;
}

export async function deleteUser(id) {
  await query('DELETE FROM users WHERE id = $1 AND role != $2', [id, 'admin']);
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
