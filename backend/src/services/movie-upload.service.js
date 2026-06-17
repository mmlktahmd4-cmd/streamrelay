import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import * as categoryService from './category.service.js';

const log = createChildLogger('movie-upload');

export const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function uploadsRoot() {
  return path.join(config.streaming.vodDir, '.uploads');
}

function sessionDir(uploadId) {
  return path.join(uploadsRoot(), uploadId);
}

function metaPath(uploadId) {
  return path.join(sessionDir(uploadId), 'meta.json');
}

function partPath(uploadId) {
  return path.join(sessionDir(uploadId), 'file.part');
}

function ensureUploadsRoot() {
  const root = uploadsRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
}

function loadMeta(uploadId) {
  const file = metaPath(uploadId);
  if (!fs.existsSync(file)) {
    throw new Error('جلسة الرفع غير موجودة');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveMeta(uploadId, meta) {
  fs.writeFileSync(metaPath(uploadId), JSON.stringify(meta));
}

function basenameWithoutExt(filename) {
  if (!filename) return 'فيلم جديد';
  const base = filename.replace(/\\/g, '/').split('/').pop() || filename;
  return base.replace(/\.[^.]+$/, '');
}

export async function createUploadSession({
  categoryId,
  filename,
  totalSize,
  total_size,
  name,
  description,
  isPublic,
  is_public,
  posterUrl,
  poster_url,
}) {
  ensureUploadsRoot();

  const size = Number(totalSize ?? total_size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('حجم الملف غير صالح');
  }
  if (size > MAX_FILE_SIZE) {
    throw new Error('الحد الأقصى لحجم الفيلم 4 GB');
  }

  if (categoryId) {
    const category = await categoryService.getCategoryById(categoryId);
    if (!category) throw new Error('Category not found');
  }

  const uploadId = randomUUID();
  fs.mkdirSync(sessionDir(uploadId), { recursive: true });
  fs.writeFileSync(partPath(uploadId), '');

  const totalChunks = Math.ceil(size / CHUNK_SIZE);
  const meta = {
    uploadId,
    categoryId,
    filename: filename || 'movie.mp4',
    totalSize: size,
    name: String(name || '').trim() || basenameWithoutExt(filename),
    description: String(description || '').trim(),
    isPublic: (is_public ?? isPublic) !== false,
    posterUrl: poster_url ?? posterUrl ?? null,
    chunkSize: CHUNK_SIZE,
    totalChunks,
    receivedChunks: 0,
    bytesWritten: 0,
    createdAt: Date.now(),
  };
  saveMeta(uploadId, meta);

  log.info({ uploadId, categoryId, totalSize: size, totalChunks }, 'Upload session created');

  return {
    upload_id: uploadId,
    chunk_size: CHUNK_SIZE,
    total_chunks: totalChunks,
  };
}

/** يُفرّغ دفق الملف الوارد بأمان حتى لا يتجمّد الطلب عند تخطّي قطعة */
function drainStream(stream) {
  try {
    if (stream && typeof stream.resume === 'function') stream.resume();
  } catch { /* ignore */ }
}

function syncResponse(meta, extra = {}) {
  return {
    received_chunks: meta.receivedChunks,
    total_chunks: meta.totalChunks,
    bytes_written: meta.bytesWritten,
    complete: meta.receivedChunks >= meta.totalChunks,
    // expected = القطعة التالية المطلوبة — يستخدمها العميل لإعادة المزامنة
    expected: meta.receivedChunks,
    ...extra,
  };
}

export function getUploadStatus({ uploadId, categoryId }) {
  const meta = loadMeta(uploadId);
  if (meta.categoryId !== categoryId) {
    throw new Error('جلسة الرفع غير صالحة');
  }
  return syncResponse(meta);
}

export async function writeUploadChunk({ uploadId, categoryId, chunkIndex, fileStream }) {
  let meta;
  try {
    meta = loadMeta(uploadId);
  } catch (err) {
    drainStream(fileStream);
    throw err;
  }

  if (meta.categoryId !== categoryId) {
    drainStream(fileStream);
    throw new Error('جلسة الرفع غير صالحة');
  }
  if (Date.now() - meta.createdAt > SESSION_TTL_MS) {
    drainStream(fileStream);
    throw new Error('انتهت جلسة الرفع — ابدأ من جديد');
  }

  const index = Number(chunkIndex);
  if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
    drainStream(fileStream);
    throw new Error('رقم القطعة غير صالح');
  }

  // إعادة مزامنة بدل الفشل: القطعة مستلمة مسبقاً (ضاعت استجابتها) أو وردت خارج
  // الترتيب. نُفرّغ الدفق ونُخبر العميل بالقطعة المطلوبة فعلاً ليُكمل من هناك —
  // هذا يجعل الرفع يشفى ذاتياً من أي انقطاع شبكة بدل التوقف.
  if (index !== meta.receivedChunks) {
    drainStream(fileStream);
    return syncResponse(meta, { resync: true });
  }

  const expectedStart = index * meta.chunkSize;
  const currentSize = fs.statSync(partPath(uploadId)).size;
  if (currentSize !== expectedStart) {
    // إصلاح ذاتي: أعد الملف إلى آخر حدّ قطعة صحيح وأعد المزامنة
    const safeSize = meta.receivedChunks * meta.chunkSize;
    try { fs.truncateSync(partPath(uploadId), safeSize); } catch { /* ignore */ }
    meta.bytesWritten = safeSize;
    saveMeta(uploadId, meta);
    drainStream(fileStream);
    return syncResponse(meta, { resync: true });
  }

  const maxChunkBytes = index === meta.totalChunks - 1
    ? meta.totalSize - expectedStart
    : meta.chunkSize;

  await pipeline(
    fileStream,
    fs.createWriteStream(partPath(uploadId), { flags: 'a', highWaterMark: 1024 * 1024 })
  );

  const nextSize = fs.statSync(partPath(uploadId)).size;
  const added = nextSize - currentSize;
  if (added <= 0 || added > maxChunkBytes + 1024) {
    fs.truncateSync(partPath(uploadId), currentSize);
    throw new Error('فشل كتابة القطعة — حجم غير صالح');
  }

  meta.receivedChunks += 1;
  meta.bytesWritten = nextSize;
  saveMeta(uploadId, meta);

  return {
    received_chunks: meta.receivedChunks,
    total_chunks: meta.totalChunks,
    bytes_written: meta.bytesWritten,
    complete: meta.receivedChunks >= meta.totalChunks,
    expected: meta.receivedChunks,
  };
}

export async function completeUploadSession({ uploadId, categoryId }) {
  const meta = loadMeta(uploadId);
  if (meta.categoryId !== categoryId) {
    throw new Error('جلسة الرفع غير صالحة');
  }
  if (meta.receivedChunks !== meta.totalChunks) {
    throw new Error(`لم يكتمل الرفع — ${meta.receivedChunks}/${meta.totalChunks} قطعة`);
  }

  const stat = fs.statSync(partPath(uploadId));
  if (stat.size !== meta.totalSize) {
    throw new Error(`حجم الملف النهائي (${stat.size}) لا يطابق المتوقع (${meta.totalSize})`);
  }

  const movie = await categoryService.finalizeMovieFromTempFile({
    categoryId,
    name: meta.name,
    description: meta.description,
    isPublic: meta.isPublic,
    posterUrl: meta.posterUrl,
    tempFilePath: partPath(uploadId),
    filename: meta.filename,
  });

  fs.rmSync(sessionDir(uploadId), { recursive: true, force: true });
  log.info({ uploadId, movieId: movie.id, size: stat.size }, 'Upload session completed');
  return movie;
}

export async function abortUploadSession(uploadId, categoryId) {
  try {
    const meta = loadMeta(uploadId);
    if (meta.categoryId !== categoryId) return;
  } catch {
    return;
  }
  fs.rmSync(sessionDir(uploadId), { recursive: true, force: true });
}
