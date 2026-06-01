import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import { verifySignedUrl } from '../utils/crypto.js';
import * as channelService from './channel.service.js';
import { getServerById, getInternalHlsBaseForServer, getLocalServer } from './server.service.js';

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

async function channelRunsOnLocalServer(channel) {
  if (!channel) return false;
  const local = await getLocalServer();
  if (!local) return !channel.server_id;
  if (!channel.server_id) return true;
  return channel.server_id === local.id;
}

/** يحذف بقايا HLS المحلية (UUID + slug) — يمنع خلط قنوات بعد نقل القناة لسيرفر بعيد */
export async function purgeLocalHlsCache(channelId, slug) {
  const targets = [channelId, slug].filter(Boolean);
  for (const key of targets) {
    try {
      await fs.rm(path.join(hlsRoot, key), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function sendLocalHlsFile(reply, localPath, file, channel) {
  if (channel?.on_demand) {
    import('./on-demand.service.js').then(({ noteOnDemandActivity, noteOnDemandSegment }) => {
      if (file.endsWith('.ts') || file.endsWith('.m4s')) {
        noteOnDemandSegment(channel.id).catch(() => {});
      } else {
        noteOnDemandActivity(channel.id).catch(() => {});
      }
    });
  }
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

export async function handleHlsRelay(request, reply) {
  const parsed = parseHlsRequest(request.url);
  if (!parsed?.streamKey || !parsed?.file) {
    return reply.status(404).send({ error: 'Not found' });
  }

  const { streamKey, file } = parsed;
  const channel = UUID_RE.test(streamKey)
    ? await channelService.getChannelById(streamKey)
    : await channelService.getChannelBySlug(streamKey);

  const { expires, sig } = request.query || {};
  if (expires && sig) {
    const key = channel?.id || streamKey;
    if (!verifySignedUrl(key, expires, sig)) {
      return reply.status(403).send({ error: 'Invalid or expired URL' });
    }
  }

  if (!channel?.id) {
    return reply.status(404).send({ error: 'Channel not found' });
  }

  const onLocal = await channelRunsOnLocalServer(channel);

  // القنوات على سيرفر بعيد: لا نقرأ القرص المحلي أبداً (كان يسبب خلط قنوات من ملفات قديمة/slug)
  if (onLocal) {
    const localPath = await fileInDir(channel.id, file);
    if (localPath) {
      return sendLocalHlsFile(reply, localPath, file, channel);
    }
  }

  if (channel.server_id) {
    const server = await getServerById(channel.server_id);
    if (server) {
      if (channel.on_demand && channel.status !== 'running') {
        const { kickOnDemandStream } = await import('./on-demand.service.js');
        kickOnDemandStream(channel.id).catch((err) => {
          log.warn({ channelId: channel.id, err: err.message }, 'On-demand kick from relay failed');
        });
      }

      const base = getInternalHlsBaseForServer(server).replace(/\/$/, '');
      const upstream = `${base}/${channel.id}/${file}`;
      try {
        const res = await fetch(upstream, {
          signal: AbortSignal.timeout(20_000),
          headers: { Accept: '*/*' },
        });
        if (!res.ok) {
          if (channel.on_demand && (res.status === 404 || res.status === 502)) {
            const { noteOnDemandActivity } = await import('./on-demand.service.js');
            await noteOnDemandActivity(channel.id);
            reply.header('Retry-After', '2');
            return reply.status(503).send({ error: 'Stream starting', starting: true });
          }
          log.warn({
            channelId: channel.id,
            channelName: channel.name,
            file,
            upstream,
            serverIp: server.ip_address,
            status: res.status,
          }, 'HLS upstream miss');
          return reply.status(res.status === 404 ? 404 : 502).send({
            error: res.status === 404 ? 'HLS not found on stream server' : 'Upstream HLS error',
            upstream,
          });
        }
        if (channel.on_demand) {
          const { noteOnDemandActivity, noteOnDemandSegment } = await import('./on-demand.service.js');
          if (file.endsWith('.ts') || file.endsWith('.m4s')) {
            await noteOnDemandSegment(channel.id);
          } else {
            await noteOnDemandActivity(channel.id);
          }
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
        if (channel.on_demand) {
          const { noteOnDemandActivity } = await import('./on-demand.service.js');
          await noteOnDemandActivity(channel.id);
          reply.header('Retry-After', '2');
          return reply.status(503).send({ error: 'Stream starting', starting: true });
        }
        log.warn({ channelId: channel.id, upstream, err: err.message }, 'HLS relay failed');
        return reply.status(502).send({ error: 'Cannot reach stream server' });
      }
    }
  }

  if (channel.on_demand) {
    if (!onLocal || channel.status !== 'running') {
      const { kickOnDemandStream, noteOnDemandActivity } = await import('./on-demand.service.js');
      noteOnDemandActivity(channel.id).catch(() => {});
      kickOnDemandStream(channel.id).catch((err) => {
        log.warn({ channelId: channel.id, err: err.message }, 'On-demand kick from relay failed');
      });
    }
    reply.header('Retry-After', '2');
    return reply.status(503).send({ error: 'Stream starting', starting: true });
  }

  return reply.status(404).send({ error: 'HLS not found' });
}

export function registerHlsRelayRoutes(app) {
  app.get(
    '/api/hls/*',
    { config: { rateLimit: false } },
    async (request, reply) => handleHlsRelay(request, reply)
  );
}
