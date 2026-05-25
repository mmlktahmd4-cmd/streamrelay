const ONLINE_TTL_MS = 3 * 60 * 1000;

/** @type {Map<string, { userId: string, username: string, role: string, ip: string|null, lastSeen: number }>} */
const sessions = new Map();

export function touchOnlineUser(user, meta = {}) {
  if (!user?.id) return;

  sessions.set(user.id, {
    userId: user.id,
    username: user.username || user.id,
    role: user.role || 'viewer',
    ip: meta.ip || null,
    lastSeen: Date.now(),
  });
}

export function removeOnlineUser(userId) {
  if (userId) sessions.delete(userId);
}

function prune() {
  const cutoff = Date.now() - ONLINE_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.lastSeen < cutoff) sessions.delete(id);
  }
}

export function getOnlineUsers() {
  prune();
  return [...sessions.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

export function getOnlineUsersCount() {
  prune();
  return sessions.size;
}
