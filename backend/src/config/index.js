import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  detectPhysicalLanIp,
  resolveHomeSubnet,
} from '../utils/network-ip.js';
import {
  buildPublicBaseUrl,
  normalizeConfiguredBaseUrl,
  readHttpPort,
} from '../utils/public-url-build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');

dotenv.config({ path: path.join(projectRoot, '.env') });

function resolveDataDir(dir, fallback) {
  const value = dir || fallback;
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function getLanIp() {
  const envIp = process.env.SERVER_IP?.trim();
  const homeSubnet = resolveHomeSubnet({
    envSubnet: process.env.SERVER_LAN_SUBNET,
    serverIp: envIp,
    publicHostname: process.env.PUBLIC_BASE_URL?.trim()
      && !process.env.PUBLIC_BASE_URL.includes('localhost')
      ? (() => {
        try { return new URL(process.env.PUBLIC_BASE_URL).hostname; } catch { return null; }
      })()
      : null,
  });

  if (envIp && (!homeSubnet || envIp.startsWith('192.168.') || envIp.startsWith('10.'))) {
    return envIp;
  }

  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured && !configured.includes('localhost') && !configured.includes('127.0.0.1')) {
    try {
      return new URL(configured).hostname;
    } catch { /* ignore */ }
  }

  return detectPhysicalLanIp(homeSubnet);
}

function resolvePublicUrl(envValue, pathSuffix = '') {
  const lanIp = getLanIp();
  const httpPort = readHttpPort();
  const base = normalizeConfiguredBaseUrl(envValue, lanIp, httpPort);
  return pathSuffix ? `${base}${pathSuffix}` : base;
}

const hlsBase = resolvePublicUrl(process.env.HLS_BASE_URL, '/api/hls');
const publicBase = resolvePublicUrl(process.env.PUBLIC_BASE_URL);

function resolveAllowedOrigins() {
  const configured = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const lanIp = getLanIp();
  const httpPort = readHttpPort();
  const baseUrl = buildPublicBaseUrl(lanIp, httpPort);
  const defaults = [
    `http://localhost:5173`,
    `http://127.0.0.1:5173`,
    `http://${lanIp}:5173`,
    `http://localhost:3000`,
    `http://127.0.0.1:3000`,
    `http://${lanIp}:3000`,
    baseUrl,
  ];

  return [...new Set([...configured, ...defaults])];
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.API_PORT || '3000', 10),
  host: process.env.API_HOST || '0.0.0.0',
  serverId: process.env.SERVER_ID || 'node-1',
  serverRole: process.env.SERVER_ROLE || 'full',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  urlSigning: {
    secret: process.env.URL_SIGNING_SECRET || 'dev-url-signing-secret',
    ttl: parseInt(process.env.SIGNED_URL_TTL || '3600', 10),
  },

  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'streamrelay',
    user: process.env.POSTGRES_USER || 'streamrelay',
    password: process.env.POSTGRES_PASSWORD || 'streamrelay_secret',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  streaming: {
    hlsDir: resolveDataDir(process.env.HLS_OUTPUT_DIR, 'data/hls'),
    mpegtsDir: resolveDataDir(process.env.MPEGTS_OUTPUT_DIR, 'data/mpegts'),
    vodDir: resolveDataDir(process.env.VOD_DIR, 'data/vod'),
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_STREAMS || '200', 10),
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '15', 10) * 1000,
    maxRestartAttempts: parseInt(process.env.MAX_RESTART_ATTEMPTS || '0', 10),
    restartCooldown: parseInt(process.env.RESTART_COOLDOWN || '5', 10) * 1000,
    startupRecoveryDelayMs: parseInt(process.env.STARTUP_RECOVERY_DELAY_SEC || '5', 10) * 1000,
    recoveryStaggerMs: parseInt(process.env.STREAM_RECOVERY_STAGGER_MS || '1000', 10),
  },

  public: {
    baseUrl: publicBase,
    rtmpIngest: process.env.RTMP_INGEST_URL || `rtmp://${getLanIp()}:1935/live`,
    hlsBase,
    allowedOrigins: resolveAllowedOrigins(),
    lanIp: getLanIp(),
  },

  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    streamMax: parseInt(process.env.STREAM_RATE_LIMIT_MAX || '30', 10),
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || '/var/log/streamrelay',
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
    email: process.env.ADMIN_EMAIL || 'admin@localhost',
  },
};
