import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { getPublicUrls } from './public-url.service.js';
import * as serverService from './server.service.js';
import { createChildLogger } from '../utils/logger.js';
import { isDockerBridgeIp } from '../utils/network-ip.js';
import { execRemoteScript, normalizeScript } from '../utils/server-ssh.js';

const log = createChildLogger('server-provision');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');

const SCRIPT_PATHS = [
  '/opt/streamrelay-scripts/provision-stream-worker.sh',
  '/opt/streamrelay/scripts/provision-stream-worker.sh',
  path.join(projectRoot, 'scripts/provision-stream-worker.sh'),
];

const REMOTE_SCRIPT = '/tmp/streamrelay-provision.sh';

function resolveMasterIp(urls) {
  const candidates = [
    process.env.SERVER_IP?.trim(),
    urls?.serverIp,
    process.env.PUBLIC_BASE_URL?.trim() && (() => {
      try { return new URL(process.env.PUBLIC_BASE_URL).hostname; } catch { return null; }
    })(),
  ].filter(Boolean);

  for (const ip of candidates) {
    if (ip === '127.0.0.1' || ip === 'localhost') continue;
    if (isDockerBridgeIp(ip)) continue;
    return ip;
  }

  throw new Error(
    'SERVER_IP غير مضبوط على السيرفر الرئيسي — أضف في .env مثلاً SERVER_IP=192.168.5.102 ثم أعد تشغيل api'
  );
}

async function loadProvisionScript() {
  for (const scriptPath of SCRIPT_PATHS) {
    try {
      const raw = await readFile(scriptPath, 'utf8');
      return normalizeScript(raw);
    } catch {
      /* try next */
    }
  }
  throw new Error('سكربت الربط غير موجود — نفّذ safe-update.sh على السيرفر الرئيسي');
}

export async function provisionRemoteServer({
  name,
  ip_address,
  ssh_username,
  ssh_password,
  ssh_port,
  hostname,
  max_streams,
  save_ssh_for_updates = true,
}) {
  const ip = String(ip_address || '').trim();
  const username = String(ssh_username || '').trim();
  if (!ip || !username || !ssh_password) {
    throw new Error('IP واسم المستخدم وكلمة مرور SSH مطلوبة');
  }

  const serverId = String(hostname || '').trim() || await serverService.suggestNextHostname();
  const existing = await serverService.getServerByHostname(serverId);
  if (existing?.is_active) {
    const next = await serverService.suggestNextHostname();
    throw new Error(
      `يوجد سيرفر نشط بنفس hostname (${serverId}) — اترك الحقل فارغاً لاستخدام ${next} أو احذف السيرفر القديم`
    );
  }

  const script = await loadProvisionScript();
  const urls = getPublicUrls();
  const masterIp = resolveMasterIp(urls);
  const httpPort = parseInt(process.env.STREAMRELAY_HTTP_PORT || String(urls.webPort || 80), 10);
  const hlsBase = `http://${ip}:${httpPort}/api/hls`;

  const env = {
    MASTER_IP: masterIp,
    SERVER_ID: serverId,
    WORKER_IP: ip,
    POSTGRES_PASSWORD: config.db.password,
    POSTGRES_USER: config.db.user,
    POSTGRES_DB: config.db.database,
    POSTGRES_PORT: String(config.db.port),
    REDIS_PASSWORD: config.redis.password || '',
    REDIS_PORT: String(config.redis.port),
    GITHUB_REPO: process.env.GITHUB_REPO || 'https://github.com/mmlktahmd4-cmd/streamrelay.git',
    GITHUB_BRANCH: process.env.GITHUB_BRANCH || 'main',
    INSTALL_DIR: '/opt/streamrelay',
    STREAMRELAY_HTTP_PORT: String(httpPort),
  };

  log.info({ ip, serverId, masterIp, httpPort }, 'Starting SSH provision');

  const { stdout, stderr } = await execRemoteScript({
    host: ip,
    port: ssh_port || 22,
    username,
    password: ssh_password,
    script,
    remotePath: REMOTE_SCRIPT,
    env,
    timeoutMs: 600_000,
  });

  log.info({ ip, serverId, stdoutLen: stdout.length }, 'SSH provision finished');

  const sshMeta = save_ssh_for_updates !== false
    ? {
      ssh_username: username,
      ssh_password: String(ssh_password),
      ssh_port: Number(ssh_port) || 22,
      auto_remote_update: true,
    }
    : {};

  const internalHls = hlsBase.replace(/\/$/, '');

  const server = await serverService.createServer({
    name: String(name || `Server ${serverId}`).trim(),
    hostname: serverId,
    ip_address: ip,
    role: 'stream-only',
    max_streams: Number(max_streams) || 100,
    hls_base_url: internalHls,
    public_base_url: `http://${ip}:${httpPort}`,
    metadata: {
      provision_status: 'success',
      provision_at: new Date().toISOString(),
      master_ip: masterIp,
      internal_hls_base_url: internalHls,
      stream_http_port: httpPort,
      provision_log: (stderr || stdout).trim().slice(-4000) || undefined,
      ...sshMeta,
    },
  });

  return {
    server,
    log: (stderr || stdout).trim().slice(-2000),
    master_ip: masterIp,
    ssh_saved: !!sshMeta.ssh_password,
  };
}
