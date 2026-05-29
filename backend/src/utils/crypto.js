import crypto from 'crypto';
import { config } from '../config/index.js';
import { getPublicUrls } from '../services/public-url.service.js';

export function generateSignedUrl(channelKey, expiresIn = null, hlsBaseOverride = null) {
  const ttl = expiresIn || config.urlSigning.ttl;
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const payload = `${channelKey}:${expires}`;
  const signature = crypto
    .createHmac('sha256', config.urlSigning.secret)
    .update(payload)
    .digest('hex');

  const hlsBase = String(hlsBaseOverride || getPublicUrls().hlsBase).replace(/\/$/, '');
  const query = `expires=${expires}&sig=${signature}`;
  const internalUrl = `${hlsBase}/${channelKey}/index.m3u8?${query}`;

  return {
    url: internalUrl,
    expires,
    signature,
  };
}

export function verifySignedUrl(channelKey, expires, signature) {
  if (!expires || !signature) return false;

  const now = Math.floor(Date.now() / 1000);
  if (parseInt(expires, 10) < now) return false;

  const payload = `${channelKey}:${expires}`;
  const expected = crypto
    .createHmac('sha256', config.urlSigning.secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}

export function generateApiToken() {
  const token = `sr_${crypto.randomBytes(32).toString('hex')}`;
  const prefix = token.substring(0, 8);
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, prefix, hash };
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 128) || `channel-${Date.now()}`;
}
