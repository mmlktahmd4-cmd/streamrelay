import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { query } from '../db/pool.js';
import { generateSlug } from '../utils/crypto.js';
import { config } from '../config/index.js';
import { getPublicUrls } from './public-url.service.js';

const ALLOWED_MIME = new Set([
  'video/mp4',
  'video/x-m4v',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'application/octet-stream',
]);

const ALLOWED_EXT = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v']);

function ensureVodDir() {
  if (!fs.existsSync(config.streaming.vodDir)) {
    fs.mkdirSync(config.streaming.vodDir, { recursive: true });
  }
}

function sanitizeExt(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return ALLOWED_EXT.has(ext) ? ext : '.mp4';
}

async function categoryColumnsAvailable() {
  try {
    const result = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'categories' AND column_name = 'is_active'
    `);
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

export async function listCategoriesWithCounts() {
  const hasExtended = await categoryColumnsAvailable();
  const catFilter = hasExtended ? 'WHERE c.is_active = true' : '';

  const result = await query(`
    SELECT c.*,
      COUNT(ch.id) FILTER (WHERE ch.is_active = true) AS live_count,
      COUNT(m.id) FILTER (WHERE m.is_active = true) AS movie_count
    FROM categories c
    LEFT JOIN channels ch ON ch.category_id = c.id
    LEFT JOIN movies m ON m.category_id = c.id
    ${catFilter}
    GROUP BY c.id
    ORDER BY c.sort_order, c.name
  `);

  return result.rows.map((row) => ({
    ...row,
    live_count: parseInt(row.live_count, 10) || 0,
    movie_count: parseInt(row.movie_count, 10) || 0,
    total_count: (parseInt(row.live_count, 10) || 0) + (parseInt(row.movie_count, 10) || 0),
    section_type: row.section_type || 'mixed',
  }));
}

export async function getCategoryById(id) {
  const result = await query('SELECT * FROM categories WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getCategoryContents(id, { publicOnly = false } = {}) {
  const category = await getCategoryById(id);
  if (!category) return null;

  const channelConditions = ['category_id = $1', 'is_active = true'];
  const movieConditions = ['category_id = $1', 'is_active = true'];
  if (publicOnly) {
    channelConditions.push('is_public = true');
    movieConditions.push('is_public = true');
  }

  const [channels, movies] = await Promise.all([
    query(
      `SELECT id, name, slug, 'live' AS content_type, status, is_public, description, logo_url, sort_order, created_at
       FROM channels WHERE ${channelConditions.join(' AND ')}
       ORDER BY sort_order, name`,
      [id]
    ),
    query(
      `SELECT id, name, slug, 'vod' AS content_type, 'running' AS status, is_public,
              file_size, mime_type, duration_seconds, description, poster_url, sort_order, created_at
       FROM movies WHERE ${movieConditions.join(' AND ')}
       ORDER BY sort_order, name`,
      [id]
    ).catch(() => ({ rows: [] })),
  ]);

  const movieItems = movies.rows.map((m) => ({ ...m, logo_url: m.poster_url || null }));
  const items = [...channels.rows, ...movieItems].sort((a, b) => {
    if (a.content_type !== b.content_type) return a.content_type === 'live' ? -1 : 1;
    return (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name);
  });

  return { ...category, section_type: category.section_type || 'mixed', items };
}

export async function createCategory(data) {
  const slug = generateSlug(data.name);
  const existing = await query('SELECT id FROM categories WHERE slug = $1', [slug]);
  if (existing.rows.length > 0) {
    throw new Error(`Category "${data.name}" already exists`);
  }

  const hasExtended = await categoryColumnsAvailable();
  if (hasExtended) {
    const result = await query(
      `INSERT INTO categories (name, slug, description, section_type, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.name, slug, data.description || null, data.section_type || 'mixed', data.sort_order || 0]
    );
    return result.rows[0];
  }

  const result = await query(
    'INSERT INTO categories (name, slug, sort_order) VALUES ($1, $2, $3) RETURNING *',
    [data.name, slug, data.sort_order || 0]
  );
  return { ...result.rows[0], section_type: data.section_type || 'mixed' };
}

export async function updateCategory(id, data) {
  const hasExtended = await categoryColumnsAvailable();
  const allowed = hasExtended
    ? ['name', 'description', 'section_type', 'sort_order']
    : ['name', 'sort_order'];

  const sets = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (data[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      values.push(data[key]);
    }
  }

  if (data.name) {
    sets.push(`slug = $${idx++}`);
    values.push(generateSlug(data.name));
  }

  if (sets.length === 0) return getCategoryById(id);

  values.push(id);
  const result = await query(
    `UPDATE categories SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function deleteCategory(id) {
  const hasExtended = await categoryColumnsAvailable();
  if (hasExtended) {
    await query('UPDATE categories SET is_active = false WHERE id = $1', [id]);
  } else {
    await query('DELETE FROM categories WHERE id = $1', [id]);
  }
  await query('UPDATE channels SET category_id = NULL WHERE category_id = $1', [id]);
  await query('UPDATE movies SET category_id = NULL WHERE category_id = $1', [id]).catch(() => {});
}

export async function uploadMovie({ categoryId, name, description, isPublic, posterUrl, fileStream, filename, mimetype }) {
  ensureVodDir();

  if (categoryId) {
    const category = await getCategoryById(categoryId);
    if (!category) throw new Error('Category not found');
  }

  const ext = sanitizeExt(filename);
  const mime = ALLOWED_MIME.has(mimetype) ? mimetype : 'video/mp4';
  let slug = generateSlug(name);
  let attempt = 0;

  while (attempt < 20) {
    const existing = await query('SELECT id FROM movies WHERE slug = $1 AND is_active = true', [slug]);
    if (existing.rows.length === 0) break;
    attempt += 1;
    slug = `${generateSlug(name)}-${attempt + 1}`;
  }

  const storedName = `${slug}${ext}`;
  const filePath = path.join(config.streaming.vodDir, storedName);
  await pipeline(fileStream, fs.createWriteStream(filePath));

  const stat = fs.statSync(filePath);
  const { baseUrl } = getPublicUrls();
  const outputUrl = `${baseUrl}/vod/${storedName}`;

  const result = await query(
    `INSERT INTO movies (name, slug, description, category_id, file_path, file_size, mime_type, output_url, poster_url, is_public)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [name, slug, description || null, categoryId || null, filePath, stat.size, mime, outputUrl, posterUrl || null, isPublic !== false]
  );

  return { ...result.rows[0], content_type: 'vod', status: 'running', logo_url: posterUrl || null };
}

export async function updateMovie(id, data) {
  const allowed = ['name', 'description', 'poster_url', 'category_id', 'is_public', 'sort_order'];
  const sets = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (data[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      values.push(data[key]);
    }
  }

  if (data.name) {
    sets.push(`slug = $${idx++}`);
    values.push(generateSlug(data.name));
  }

  if (sets.length === 0) return getMovieById(id);

  sets.push('updated_at = NOW()');
  values.push(id);

  const result = await query(
    `UPDATE movies SET ${sets.join(', ')} WHERE id = $${idx} AND is_active = true RETURNING *`,
    values
  );

  const row = result.rows[0] || null;
  if (!row) return null;
  return { ...row, content_type: 'vod', status: 'running', logo_url: row.poster_url || null };
}

export async function getMovieById(id) {
  const result = await query('SELECT * FROM movies WHERE id = $1 AND is_active = true', [id]);
  const row = result.rows[0] || null;
  if (!row) return null;
  return { ...row, content_type: 'vod', status: 'running', logo_url: row.poster_url || null };
}

export async function deleteMovie(id) {
  const row = await getMovieById(id);
  if (!row) throw new Error('Movie not found');

  if (row.file_path && fs.existsSync(row.file_path)) {
    try { fs.unlinkSync(row.file_path); } catch { /* ignore */ }
  }

  await query('UPDATE movies SET is_active = false WHERE id = $1', [id]);
}

export function getVodPlaybackUrl(movie) {
  if (!movie?.slug) return null;
  const ext = path.extname(movie.file_path || '') || '.mp4';
  const { baseUrl } = getPublicUrls();
  return `${baseUrl}/vod/${movie.slug}${ext}`;
}

export async function listPublicMovies() {
  try {
    const result = await query(
      `SELECT id, name, slug, 'vod' AS content_type, 'running' AS status, is_public,
              category_id, file_size, mime_type, description, poster_url, sort_order, created_at
       FROM movies WHERE is_active = true AND is_public = true
       ORDER BY sort_order, name`
    );
    return result.rows.map((row) => ({
      ...row,
      logo_url: row.poster_url || null,
    }));
  } catch {
    return [];
  }
}
