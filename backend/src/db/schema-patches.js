import { query } from './pool.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('schema-patches');

const PATCHES = [
  {
    id: '003_categories_extended',
    sql: `
      ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE categories ADD COLUMN IF NOT EXISTS section_type VARCHAR(16) NOT NULL DEFAULT 'mixed';
      ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
    `,
    optional: true,
  },
  {
    id: '005_movies_table',
    sql: `
      CREATE TABLE IF NOT EXISTS movies (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name        VARCHAR(255) NOT NULL,
        slug        VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
        file_path   TEXT NOT NULL,
        file_size   BIGINT,
        mime_type   VARCHAR(128),
        duration_seconds INT,
        output_url  TEXT,
        is_public   BOOLEAN NOT NULL DEFAULT true,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        sort_order  INT NOT NULL DEFAULT 0,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_movies_category ON movies(category_id);
      CREATE INDEX IF NOT EXISTS idx_movies_slug ON movies(slug);
    `,
  },
];

export async function runSchemaPatches() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_patches (
      id VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const patch of PATCHES) {
    const existing = await query('SELECT id FROM schema_patches WHERE id = $1', [patch.id]);
    if (existing.rows.length > 0) continue;

    try {
      await query(patch.sql);
      await query('INSERT INTO schema_patches (id) VALUES ($1)', [patch.id]);
      log.info({ patch: patch.id }, 'Schema patch applied');
    } catch (err) {
      if (patch.optional && err.code === '42501') {
        log.warn({ patch: patch.id }, 'Optional patch skipped (insufficient DB permissions)');
        continue;
      }
      log.error({ patch: patch.id, err: err.message }, 'Schema patch failed');
      throw err;
    }
  }
}
