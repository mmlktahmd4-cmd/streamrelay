import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { verifySignedUrl } from '../utils/crypto.js';
import * as channelService from './channel.service.js';
import { getServerById, getHlsBaseForServer } from './server.service.js';

const log = createChildLogger('hls-relay');
const hlsRoot = path.resolve(config.streaming.hlsDir);

const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function parseHlsRequest(url) {
  const match = String(url || '').match(/^\/api\/hls\/([^/?]+)\/(.+?)(?:\?|$)/);
  if (!match) return null;
  return {
    streamKey: decodeURIComponent(match[1]),
    file: match[2].replace(/\.\./g, ''),
  };
}

async function fileInDir(dirKey, file) {
  if (!dirKey) return null;
  const fp = path.join(hlsRoot, dirKey, file);
  try {
    const stat = await fs.stat(fp);
    return stat.isFile() && stat.size > 0 ? fp : null;
  } catch {
    return null;
  }
}

export async function handleHlsRelay(request, reply) {
  const parsed = parseHlsRequest(request.url);
  if (!parsed?.streamKey || !parsed?.file) {
    return reply.status(404).send({ error: 'Not found' });
  }

  const { streamKey, file } = parsed;
  const channel = UUID_RE.test(streamKey)
    ? await channelService.getChannelById(streamKey)
    : await channelService.getChannelBySlug(streamKey);

  // التحقق من التوقيع (المفتاح = معرّف القناة UUID)
  const { expires, sig } = request.query || {};
  if (expires && sig) {
    const key = channel?.id || streamKey;
    if (!verifySignedUrl(key, expires, sig)) {
      return reply.status(403).send({ error: 'Invalid or expired URL' });
    }
  }

  // المجلد على القرص باسم UUID — مع تجربة الـ slug للتوافق مع قنوات قديمة
  const localPath = await fileInDir(channel?.id, file)
    || await fileInDir(streamKey, file)
    || (channel?.slug ? await fileInDir(channel.slug, file) : null);

  if (localPath) {
    reply.header('Access-Control-Allow-Origin', '*');
    if (file.endsWith('.m3u8')) {
      reply.header('Content-Type', 'application/vnd.apple.mpegurl');
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (file.endsWith('.ts')) {
      reply.header('Content-Type', 'video/mp2t');
      reply.header('Cache-Control', 'max-age=5');
    }
    return reply.send(createReadStream(localPath));
  }

  // قناة على سيرفر بعيد — وكّل الطلب لـ HLS الخاص به
  if (channel?.server_id) {
    const server = await getServerById(channel.server_id);
    if (server) {
      const base = getHlsBaseForServer(server).replace(/\/$/, '');
      const upstream = `${base}/${channel.id}/${file}`;
      try {
        const res = await fetch(upstream, {
          signal: AbortSignal.timeout(20_000),
          headers: { Accept: '*/*' },
        });
        if (!res.ok) {
          log.warn({ channelId: channel.id, file, upstream, status: res.status }, 'HLS upstream miss');
          return reply.status(res.status === 404 ? 404 : 502).send({ error: 'Upstream HLS error' });
        }
        const body = Buffer.from(await res.arrayBuffer());
        if (file.endsWith('.m3u8')) {
          reply.header('Content-Type', 'application/vnd.apple.mpegurl');
          reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (file.endsWith('.ts')) {
          reply.header('Content-Type', 'video/mp2t');
          reply.header('Cache-Control', 'max-age=5');
        }
        reply.header('Access-Control-Allow-Origin', '*');
        return reply.send(body);
      } catch (err) {
        log.warn({ channelId: channel.id, upstream, err: err.message }, 'HLS relay failed');
        return reply.status(502).send({ error: 'Cannot reach stream server' });
      }
    }
  }

  return reply.status(404).send({ error: 'HLS not found' });
}

export function registerHlsRelayRoutes(app) {
  app.get('/api/hls/*', async (request, reply) => handleHlsRelay(request, reply));
}
