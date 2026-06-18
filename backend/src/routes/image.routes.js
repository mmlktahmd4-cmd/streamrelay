import dns from 'dns/promises';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('image-proxy');

const FETCH_TIMEOUT_MS = 12000;
const MAX_BYTES = 15 * 1024 * 1024; // 15MB

/** يمنع SSRF — يرفض العناوين الداخلية/الخاصة */
function isPrivateIp(ip) {
  if (!ip) return true;
  // IPv6 محلي / link-local / ULA
  if (ip === '::1' || ip === '::') return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // IPv4 المُضمّن في IPv6
  const v4 = lower.startsWith('::ffff:') ? lower.slice(7) : ip;
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // ليس IPv4 — تُركت فحوص IPv6 أعلاه
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export default async function imageRoutes(fastify) {
  // وكيل صور — يجلب الشعارات/الملصقات الخارجية من السيرفر ويقدّمها من أصل اللوحة
  // لتفادي حظر الـ hotlink ومشكلة المحتوى المختلط (HTTP/HTTPS). بلا مصادقة لأن
  // وسم <img> لا يرسل توكن، مع حماية SSRF صارمة.
  fastify.get('/img', async (request, reply) => {
    const raw = request.query?.u || request.query?.url;
    if (!raw) return reply.status(400).send({ error: 'missing url' });

    let target;
    try {
      target = new URL(String(raw));
    } catch {
      return reply.status(400).send({ error: 'bad url' });
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return reply.status(400).send({ error: 'unsupported protocol' });
    }

    try {
      const addrs = await dns.lookup(target.hostname, { all: true });
      if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
        return reply.status(403).send({ error: 'blocked host' });
      }
    } catch {
      return reply.status(502).send({ error: 'dns failed' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(target.href, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (StreamRelay)',
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        },
      });

      if (!res.ok) return reply.status(502).send({ error: `upstream ${res.status}` });

      const ctype = res.headers.get('content-type') || 'image/jpeg';
      if (!ctype.startsWith('image/') && !/octet-stream/i.test(ctype)) {
        return reply.status(415).send({ error: 'not an image' });
      }

      const declared = Number(res.headers.get('content-length') || 0);
      if (declared && declared > MAX_BYTES) {
        return reply.status(413).send({ error: 'image too large' });
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) {
        return reply.status(413).send({ error: 'image too large' });
      }

      reply.header('Content-Type', ctype.startsWith('image/') ? ctype : 'image/jpeg');
      reply.header('Cache-Control', 'public, max-age=604800, immutable');
      reply.header('Access-Control-Allow-Origin', '*');
      return reply.send(buf);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        log.debug({ err: err?.message, url: target.href }, 'image proxy fetch failed');
      }
      return reply.status(502).send({ error: 'fetch failed' });
    } finally {
      clearTimeout(timer);
    }
  });
}
