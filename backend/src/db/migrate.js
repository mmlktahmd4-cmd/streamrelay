import bcrypt from 'bcryptjs';
import { query } from './pool.js';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { runSchemaPatches } from './schema-patches.js';

const log = createChildLogger('migrate');

export async function bootstrapAdmin() {
  const existing = await query('SELECT id FROM users WHERE username = $1', [config.admin.username]);
  if (existing.rows.length > 0) {
    log.info('Admin user already exists, skipping bootstrap');
    return;
  }

  const hash = await bcrypt.hash(config.admin.password, 12);
  await query(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')`,
    [config.admin.username, config.admin.email, hash]
  );
  log.info({ username: config.admin.username }, 'Admin user created');
}

export async function bootstrapServer() {
  const existing = await query('SELECT id FROM servers WHERE hostname = $1', [config.serverId]);
  if (existing.rows.length > 0) return;

  await query(
    `INSERT INTO servers (name, hostname, role, max_streams)
     VALUES ($1, $2, $3, $4)`,
    [`Server ${config.serverId}`, config.serverId, config.serverRole, config.streaming.maxConcurrent]
  );
  log.info({ serverId: config.serverId }, 'Server node registered');
}

export async function runMigrations() {
  await runSchemaPatches();
  await bootstrapAdmin();
  await bootstrapServer();
  log.info('Database bootstrap complete');
}
