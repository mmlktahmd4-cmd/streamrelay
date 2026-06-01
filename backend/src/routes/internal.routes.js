import * as channelService from '../services/channel.service.js';
import { noteOnDemandSegment, noteOnDemandActivity } from '../services/on-demand.service.js';

const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function isTrustedInternalRequest(request) {
  if (request.headers['x-streamrelay-internal'] === '1') return true;
  const ip = String(request.ip || '');
  return ip === '127.0.0.1'
    || ip === '::1'
    || ip === '::ffff:127.0.0.1'
    || ip.startsWith('172.')
    || ip.startsWith('10.')
    || ip.startsWith('192.168.');
}

export default async function internalRoutes(fastify) {
  /** نبضة مشاهدة عند تقديم nginx للمقطع مباشرة (Xtream-style) */
  fastify.get('/hls/pulse/:channelId', async (request, reply) => {
    if (!isTrustedInternalRequest(request)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const { channelId } = request.params;
    if (!UUID_RE.test(channelId)) {
      return reply.status(404).send({ error: 'Invalid channel' });
    }

    const channel = await channelService.getChannelById(channelId);
    if (!channel) return reply.status(404).send({ error: 'Not found' });

    if (channel.on_demand) {
      await noteOnDemandSegment(channel.id);
    } else {
      await noteOnDemandActivity(channel.id);
    }

    return reply.send({ ok: true });
  });
}
