import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { query } from '../db/pool.js';
import { createChildLogger } from '../utils/logger.js';
import { listNetworkInterfaces } from '../utils/network-interfaces.js';
import { syncEnvPublicUrls, getEnvFilePath } from '../utils/env-file.js';
import { isRunningInContainer } from '../utils/network-ip.js';
import { refreshPublicUrlCache, getPublicUrls } from './public-url.service.js';

const log = createChildLogger('server-ip');
const execFileAsync = promisify(execFile);

const SETTINGS_KEY = 'server_network';

function isValidIpv4(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const n = parseInt(part, 10);
    return String(n) === part && n >= 0 && n <= 255;
  });
}

async function loadServerNetworkSettings() {
  try {
    const result = await query(`SELECT value FROM settings WHERE key = $1`, [SETTINGS_KEY]);
    return result.rows[0]?.value || {};
  } catch {
    return {};
  }
}

async function saveServerNetworkSettings(value) {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SETTINGS_KEY, value]
  );
}

function getInstallDir() {
  return process.env.STREAMRELAY_INSTALL_DIR?.trim() || '/opt/streamrelay';
}

function dockerSocketAvailable() {
  try {
    return fs.existsSync('/var/run/docker.sock');
  } catch {
    return false;
  }
}

async function detectHostInterfacesViaDocker() {
  const installDir = getInstallDir();
  const composeFile = `${installDir}/docker-compose.yml`;

  if (!dockerSocketAvailable() || !fs.existsSync(composeFile)) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('docker', [
      'compose',
      '-f', composeFile,
      '--project-directory', installDir,
      'run', '--rm', '--no-deps', '--net=host', '-T',
      'api', 'node', 'src/scripts/list-host-interfaces.js',
    ], { timeout: 120000, maxBuffer: 1024 * 1024 });

    const parsed = JSON.parse(stdout.trim());
    if (Array.isArray(parsed?.interfaces) && parsed.interfaces.length > 0) {
      return parsed.interfaces;
    }
  } catch (err) {
    log.warn({ err: err.message }, 'Host interface detection via docker failed');
  }

  return null;
}

async function listAvailableInterfaces() {
  const hostDetected = await detectHostInterfacesViaDocker();
  const local = listNetworkInterfaces();
  const interfaces = hostDetected?.length ? hostDetected : local;

  return {
    interfaces,
    detection: hostDetected?.length ? 'host' : (isRunningInContainer() ? 'configured' : 'local'),
    in_container: isRunningInContainer(),
    docker_detection: !!hostDetected?.length,
  };
}

async function recreateDockerServices() {
  const installDir = getInstallDir();
  const composeFile = `${installDir}/docker-compose.yml`;

  if (!dockerSocketAvailable() || !fs.existsSync(composeFile)) {
    return { recreated: false, reason: 'docker_unavailable' };
  }

  try {
    await execFileAsync('docker', [
      'compose',
      '-f', composeFile,
      '--project-directory', installDir,
      'up', '-d', '--force-recreate', 'api', 'worker', 'nginx',
    ], { timeout: 180000 });

    return { recreated: true };
  } catch (err) {
    log.warn({ err: err.message }, 'Docker recreate failed');
    return { recreated: false, reason: err.message };
  }
}

function interfaceAllowsIp(interfaces, ip) {
  if (interfaces.some((item) => item.address === ip)) return true;

  const urls = getPublicUrls();
  return ip === urls.serverIp || ip === urls.detectedIp;
}

export async function getServerIpConfig() {
  const [{ interfaces, detection, in_container, docker_detection }, pinned, urls] = await Promise.all([
    listAvailableInterfaces(),
    loadServerNetworkSettings(),
    Promise.resolve(getPublicUrls()),
  ]);

  return {
    interfaces,
    detection,
    in_container,
    docker_detection,
    env_file: getEnvFilePath(),
    env_writable: (() => {
      try {
        fs.accessSync(getEnvFilePath(), fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    })(),
    pinned: {
      ip: pinned.pinned_ip || urls.serverIp,
      interface_name: pinned.interface_name || null,
      updated_at: pinned.updated_at || null,
    },
    current: urls,
  };
}

export async function applyServerIp({ ip, interface_name: interfaceName }) {
  const trimmed = String(ip || '').trim();
  if (!isValidIpv4(trimmed)) {
    throw new Error('أدخل عنوان IPv4 صحيح (مثل 192.168.1.100)');
  }

  const { interfaces } = await listAvailableInterfaces();
  if (!interfaceAllowsIp(interfaces, trimmed)) {
    throw new Error('هذا IP غير موجود على كروت الشبكة المكتشفة — اختر IP من القائمة');
  }

  const matched = interfaces.find((item) => item.address === trimmed);
  const envSync = syncEnvPublicUrls(trimmed);

  await saveServerNetworkSettings({
    pinned_ip: trimmed,
    interface_name: interfaceName || matched?.name || null,
    updated_at: new Date().toISOString(),
  });

  const urls = await refreshPublicUrlCache({ syncUrls: true });

  let servicesRecreated = false;
  if (envSync.envWritten && dockerSocketAvailable()) {
    servicesRecreated = true;
    setImmediate(() => {
      recreateDockerServices().catch((err) => {
        log.warn({ err: err.message }, 'Background docker recreate failed');
      });
    });
  }

  log.info({
    ip: trimmed,
    interface: interfaceName || matched?.name,
    envWritten: envSync.envWritten,
    servicesRecreated,
  }, 'Server IP applied from admin panel');

  let message = 'تم تثبيت IP وتحديث روابط القنوات واللوحة';
  if (!envSync.envWritten) {
    message += ` — نفّذ على السيرفر: sudo bash scripts/fix-server-ip.sh ${trimmed}`;
  } else if (servicesRecreated) {
    message += ' — جاري إعادة تشغيل الخدمات...';
  }

  return {
    ok: true,
    message,
    ip: trimmed,
    interface_name: interfaceName || matched?.name || null,
    env_written: envSync.envWritten,
    services_recreated: servicesRecreated,
    urls,
    preview: {
      baseUrl: urls.baseUrl,
      hlsBase: urls.hlsBase,
      viewerUrl: urls.viewerUrl,
      adminUrl: urls.adminUrl,
    },
  };
}
