import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildPublicBaseUrl, readHttpPort } from './public-url-build.js';
import { subnetFromIp } from './network-ip.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const projectRoot = path.resolve(backendRoot, '..');

function isPrivateIp(ip) {
  const value = String(ip || '').trim();
  if (value.startsWith('192.168.') || value.startsWith('10.')) return true;
  return /^172\.(1[6-9]|2[0-9]|3[01])\./.test(value);
}

export function getEnvFilePath() {
  const fromEnv = process.env.STREAMRELAY_ENV_FILE?.trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    path.join(projectRoot, '.env'),
    path.join(backendRoot, '.env'),
    '/opt/streamrelay/.env',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return path.join(projectRoot, '.env');
}

function upsertEnvLine(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  const suffix = content.endsWith('\n') || content.length === 0 ? '' : '\n';
  return `${content}${suffix}${line}\n`;
}

function removeEnvKey(content, key) {
  return content.replace(new RegExp(`^${key}=.*\n?`, 'm'), '');
}

export function applyEnvToProcess(vars) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
}

function buildPublicLinkVars(baseUrl, { serverIp, httpPort = readHttpPort() } = {}) {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/$/, '');
  const hlsBase = `${normalizedBase}/api/hls`;
  const allowedOrigins = [
    normalizedBase,
    'http://localhost',
    'http://127.0.0.1',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].join(',');

  const vars = {
    PUBLIC_BASE_URL: normalizedBase,
    HLS_BASE_URL: hlsBase,
    ALLOWED_ORIGINS: allowedOrigins,
  };

  if (serverIp) {
    vars.STREAMRELAY_HTTP_PORT = String(httpPort);
    vars.SERVER_IP = serverIp;
    vars.RTMP_INGEST_URL = `rtmp://${serverIp}:1935/live`;
  }

  return { normalizedBase, hlsBase, vars };
}

/** يحدّث روابط .env العامة (دومين أو IP) دون تغيير SERVER_IP إن لم يُمرَّر */
export function syncEnvPublicLinks(baseUrl, { serverIp, httpPort = readHttpPort() } = {}) {
  const envPath = getEnvFilePath();
  const { normalizedBase, hlsBase, vars } = buildPublicLinkVars(baseUrl, { serverIp, httpPort });

  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  for (const [key, value] of Object.entries(vars)) {
    content = upsertEnvLine(content, key, value);
  }

  let envWritten = false;
  try {
    fs.writeFileSync(envPath, content, 'utf8');
    envWritten = true;
  } catch {
    envWritten = false;
  }

  applyEnvToProcess(vars);

  return {
    envPath,
    envWritten,
    baseUrl: normalizedBase,
    hlsBase,
    vars,
  };
}

export function syncEnvPublicUrls(ip, httpPort = readHttpPort()) {
  const envPath = getEnvFilePath();
  const baseUrl = buildPublicBaseUrl(ip, httpPort);
  const { hlsBase, vars } = buildPublicLinkVars(baseUrl, { serverIp: ip, httpPort });

  const subnet = isPrivateIp(ip) ? subnetFromIp(ip) : null;
  if (subnet) {
    vars.SERVER_LAN_SUBNET = subnet;
  }

  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  for (const [key, value] of Object.entries(vars)) {
    content = upsertEnvLine(content, key, value);
  }

  if (!subnet) {
    content = removeEnvKey(content, 'SERVER_LAN_SUBNET');
  }

  let envWritten = false;
  try {
    fs.writeFileSync(envPath, content, 'utf8');
    envWritten = true;
  } catch {
    envWritten = false;
  }

  applyEnvToProcess(vars);
  if (!subnet) {
    delete process.env.SERVER_LAN_SUBNET;
  }

  return {
    envPath,
    envWritten,
    baseUrl,
    hlsBase,
    vars,
  };
}
