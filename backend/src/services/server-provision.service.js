import { Client } from 'ssh2';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { getPublicUrls } from './public-url.service.js';
import * as serverService from './server.service.js';
import { createChildLogger } from '../utils/logger.js';
import { isDockerBridgeIp } from '../utils/network-ip.js';

const log = createChildLogger('server-provision');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');

const SCRIPT_PATHS = [
  '/opt/streamrelay-scripts/provision-stream-worker.sh',
  '/opt/streamrelay/scripts/provision-stream-worker.sh',
  path.join(projectRoot, 'scripts/provision-stream-worker.sh'),
];

const REMOTE_SCRIPT = '/tmp/streamrelay-provision.sh';

function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

function normalizeScript(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

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

function connectSsh({ host, port, username, password }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', (err) => reject(new Error(`فشل SSH: ${err.message}`)));
    conn.connect({
      host,
      port: port || 22,
      username,
      password,
      readyTimeout: 30_000,
      tryKeyboard: false,
    });
  });
}

function uploadScript(conn, script) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const stream = sftp.createWriteStream(REMOTE_SCRIPT, { mode: 0o755 });
      stream.on('error', reject);
      stream.on('close', resolve);
      stream.end(Buffer.from(script, 'utf8'));
    });
  });
}

function runRemote(conn, command) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      stream.on('data', (chunk) => { stdout += chunk.toString(); });
      stream.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      stream.on('close', (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else {
          const detail = (stderr || stdout).trim().slice(-3000);
          reject(new Error(detail || `فشل الأمر (exit ${code})`));
        }
      });
    });
  });
}

function buildRunCommand({ username, password, env }) {
  const envExports = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ');

  const scriptCall = `bash ${REMOTE_SCRIPT}`;

  if (username === 'root') {
    return `export ${envExports} && ${scriptCall}`;
  }

  return `export ${envExports} && (echo ${shellQuote(password)} | sudo -S -p '' ${scriptCall} || sudo -n ${scriptCall})`;
}

async function execSshProvision({ host, port, username, password, script, env }) {
  const conn = await connectSsh({ host, port, username, password });
  const timeout = setTimeout(() => {
    conn.end();
  }, 600_000);

  try {
    await runRemote(conn, 'uname -a');
    await uploadScript(conn, script);
    const command = buildRunCommand({ username, password, env });
    log.info({ host, username }, 'Running provision script');
    const result = await runRemote(conn, command);
    return result;
  } finally {
    clearTimeout(timeout);
    conn.end();
  }
}

export async function suggestNextHostname() {
  const servers = await serverService.listServers();
  let max = 1;
  for (const server of servers) {
    const match = /^node-(\d+)$/i.exec(server.hostname || '');
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `node-${max + 1}`;
}

export async function provisionRemoteServer({
  name,
  ip_address,
  ssh_username,
  ssh_password,
  ssh_port,
  hostname,
  max_streams,
}) {
  const ip = String(ip_address || '').trim();
  const username = String(ssh_username || '').trim();
  if (!ip || !username || !ssh_password) {
    throw new Error('IP واسم المستخدم وكلمة مرور SSH مطلوبة');
  }

  const serverId = String(hostname || '').trim() || await suggestNextHostname();
  const existing = await serverService.getServerByHostname(serverId);
  if (existing?.is_active) {
    throw new Error(`يوجد سيرفر بنفس hostname: ${serverId}`);
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

  const { stdout, stderr } = await execSshProvision({
    host: ip,
    port: ssh_port || 22,
    username,
    password: ssh_password,
    script,
    env,
  });

  log.info({ ip, serverId, stdoutLen: stdout.length }, 'SSH provision finished');

  const server = await serverService.createServer({
    name: String(name || `Server ${serverId}`).trim(),
    hostname: serverId,
    ip_address: ip,
    role: 'stream-only',
    max_streams: Number(max_streams) || 100,
    hls_base_url: hlsBase,
    public_base_url: `http://${ip}:${httpPort}`,
    metadata: {
      provision_status: 'success',
      provision_at: new Date().toISOString(),
      ssh_username: username,
      master_ip: masterIp,
      provision_log: (stderr || stdout).trim().slice(-4000) || undefined,
    },
  });

  return {
    server,
    log: (stderr || stdout).trim().slice(-2000),
    master_ip: masterIp,
  };
}
