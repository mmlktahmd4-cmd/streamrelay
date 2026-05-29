import { Client } from 'ssh2';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { getPublicUrls } from './public-url.service.js';
import * as serverService from './server.service.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('server-provision');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');

const SCRIPT_PATHS = [
  '/opt/streamrelay-scripts/provision-stream-worker.sh',
  '/opt/streamrelay/scripts/provision-stream-worker.sh',
  path.join(projectRoot, 'scripts/provision-stream-worker.sh'),
];

function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

async function loadProvisionScript() {
  for (const scriptPath of SCRIPT_PATHS) {
    try {
      return await readFile(scriptPath, 'utf8');
    } catch {
      /* try next path */
    }
  }
  throw new Error('سكربت الربط غير موجود — حدّث StreamRelay على السيرفر الرئيسي');
}

function execSshScript({ host, port, username, password, script, env }) {
  const envExports = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ');

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('انتهت مهلة الربط (10 دقائق)'));
    }, 600_000);

    conn.on('ready', () => {
      conn.exec(`export ${envExports} && bash -s`, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          conn.end();
          reject(err);
          return;
        }

        stream.write(script);
        stream.end();

        stream.on('data', (chunk) => { stdout += chunk.toString(); });
        stream.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        stream.on('close', (code) => {
          clearTimeout(timeout);
          conn.end();
          if (code === 0) {
            resolve({ stdout, stderr });
            return;
          }
          const detail = (stderr || stdout).trim().slice(-2000);
          reject(new Error(detail || `فشل الربط (exit ${code})`));
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`فشل SSH: ${err.message}`));
    });

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
  const masterIp = urls.serverIp;
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

  log.info({ ip, serverId, masterIp }, 'Starting SSH provision');

  const { stdout, stderr } = await execSshScript({
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
      provision_log: (stderr || stdout).trim().slice(-4000) || undefined,
    },
  });

  return {
    server,
    log: (stderr || stdout).trim().slice(-2000),
  };
}
