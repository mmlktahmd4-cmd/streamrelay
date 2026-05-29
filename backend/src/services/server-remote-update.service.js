import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import * as serverService from './server.service.js';
import { createChildLogger } from '../utils/logger.js';
import { execRemoteScript, normalizeScript } from '../utils/server-ssh.js';

const log = createChildLogger('server-remote-update');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');

const REMOTE_UPDATE_SCRIPT = '/tmp/streamrelay-update-remote.sh';

const UPDATE_SCRIPT_PATHS = [
  '/opt/streamrelay-scripts/update-remote-worker.sh',
  '/opt/streamrelay/scripts/update-remote-worker.sh',
  path.join(projectRoot, 'scripts/update-remote-worker.sh'),
];

function isAutoUpdateEnabled(metadata) {
  if (metadata?.auto_remote_update === false) return false;
  return !!(metadata?.ssh_username && metadata?.ssh_password);
}

export function sanitizeServerMetadata(metadata = {}) {
  const meta = { ...metadata };
  const configured = !!(meta.ssh_username && meta.ssh_password);
  delete meta.ssh_password;
  return {
    ...meta,
    ssh_configured: configured,
  };
}

async function loadUpdateScript() {
  for (const scriptPath of UPDATE_SCRIPT_PATHS) {
    try {
      const raw = await readFile(scriptPath, 'utf8');
      return normalizeScript(raw);
    } catch {
      /* try next */
    }
  }
  throw new Error('سكربت تحديث البعيد غير موجود — نفّذ safe-update.sh على السيرفر الرئيسي أولاً');
}

export async function listServersEligibleForRemoteUpdate() {
  const local = await serverService.getLocalServer();
  const result = await serverService.listServers();
  return result.filter((s) => {
    if (!s.is_active || s.is_local) return false;
    if (local && s.id === local.id) return false;
    if (!serverService.canRunStreams(s.role)) return false;
    if (!s.ip_address) return false;
    return s.metadata?.ssh_configured && s.metadata?.auto_remote_update !== false;
  });
}

export async function updateRemoteServer(serverId) {
  const server = await serverService.getServerById(serverId);
  if (!server) throw new Error('السيرفر غير موجود');
  if (server.is_local) throw new Error('لا يمكن تحديث السيرفر المحلي عبر SSH');
  if (!server.ip_address) throw new Error('لا يوجد IP للسيرفر');

  const meta = await serverService.getServerMetadataRaw(serverId);
  if (!isAutoUpdateEnabled(meta)) {
    throw new Error(
      'بيانات SSH غير محفوظة — أعد الربط التلقائي (SSH) أو أضف SSH من تعديل السيرفر'
    );
  }

  const script = await loadUpdateScript();
  const host = String(server.ip_address).trim();
  const username = String(meta.ssh_username).trim();
  const password = String(meta.ssh_password);
  const port = Number(meta.ssh_port) || 22;

  const env = {
    GITHUB_REPO: process.env.GITHUB_REPO || 'https://github.com/mmlktahmd4-cmd/streamrelay.git',
    GITHUB_BRANCH: process.env.GITHUB_BRANCH || 'main',
    INSTALL_DIR: '/opt/streamrelay',
  };

  log.info({ host, hostname: server.hostname }, 'Starting remote update via SSH');

  const startedAt = new Date().toISOString();
  let status = 'success';
  let errorMessage = null;
  let logTail = '';

  try {
    const { stdout, stderr } = await execRemoteScript({
      host,
      port,
      username,
      password,
      script,
      remotePath: REMOTE_UPDATE_SCRIPT,
      env,
      timeoutMs: 900_000,
    });
    logTail = (stderr || stdout).trim().slice(-4000);
  } catch (err) {
    status = 'failed';
    errorMessage = err.message;
    logTail = err.message.slice(-4000);
    log.warn({ host, hostname: server.hostname, err: err.message }, 'Remote update failed');
  }

  const finishedAt = new Date().toISOString();
  const commitMatch = logTail.match(/commit=([^\s]+)/i)
    || logTail.match(/Git commit:\s*(\S+)/i);
  await serverService.patchServerMetadata(serverId, {
    last_remote_update: finishedAt,
    last_remote_update_status: status,
    last_remote_update_error: errorMessage || undefined,
    last_remote_update_commit: commitMatch?.[1] || undefined,
    remote_update_log: logTail || undefined,
    remote_update_started_at: startedAt,
  });

  if (status === 'failed') {
    throw new Error(errorMessage || 'فشل تحديث السيرفر البعيد');
  }

  return {
    server_id: serverId,
    hostname: server.hostname,
    status,
    commit: commitMatch?.[1] || null,
    log: logTail.slice(-2000),
  };
}

export async function syncAllRemoteWorkers() {
  if (process.env.AUTO_UPDATE_REMOTES === '0') {
    log.info('AUTO_UPDATE_REMOTES=0 — skipping remote sync');
    return { skipped: true, results: [], updated: 0, failed: 0 };
  }

  const eligible = await listServersEligibleForRemoteUpdate();
  if (eligible.length === 0) {
    log.info('No remote servers with SSH credentials for auto-update');
    return { skipped: false, results: [], updated: 0, failed: 0, message: 'لا توجد سيرفرات بعيدة ببيانات SSH' };
  }

  log.info({ count: eligible.length }, 'Syncing remote workers after master update');

  const results = [];
  let updated = 0;
  let failed = 0;

  for (const server of eligible) {
    try {
      const result = await updateRemoteServer(server.id);
      results.push(result);
      updated += 1;
    } catch (err) {
      failed += 1;
      results.push({
        server_id: server.id,
        hostname: server.hostname,
        status: 'failed',
        error: err.message,
      });
    }
  }

  return { skipped: false, results, updated, failed, total: eligible.length };
}

export async function saveServerSshCredentials(serverId, { ssh_username, ssh_password, ssh_port, auto_remote_update }) {
  const server = await serverService.getServerById(serverId);
  if (!server) throw new Error('السيرفر غير موجود');
  if (server.is_local) throw new Error('السيرفر المحلي لا يحتاج SSH');

  const patch = {};
  if (ssh_username != null) patch.ssh_username = String(ssh_username).trim();
  if (ssh_password != null && String(ssh_password).length > 0) patch.ssh_password = String(ssh_password);
  if (ssh_port != null) patch.ssh_port = Number(ssh_port) || 22;
  if (auto_remote_update != null) patch.auto_remote_update = !!auto_remote_update;

  if (!patch.ssh_username && !server.metadata?.ssh_username) {
    throw new Error('اسم مستخدم SSH مطلوب');
  }
  const finalUser = patch.ssh_username || server.metadata?.ssh_username;
  const existingRaw = await serverService.getServerMetadataRaw(serverId);
  const finalPass = patch.ssh_password || existingRaw?.ssh_password;
  if (!finalUser || !finalPass) {
    throw new Error('اسم المستخدم وكلمة مرور SSH مطلوبان للتحديث التلقائي');
  }

  await serverService.patchServerMetadata(serverId, patch);
  return serverService.getServerById(serverId);
}
