import pg from 'pg';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('database');

const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  log.error({ err }, 'Unexpected database pool error');
});

export async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) {
    log.warn({ duration, query: text.substring(0, 80) }, 'Slow query');
  }
  return result;
}

export async function getClient() {
  return pool.connect();
}

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export { pool };
