import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { query } from '../db/pool.js';
import { createChildLogger } from '../utils/logger.js';
import { listNetworkInterfaces } from '../utils/network-interfaces.js';
import { syncEnvPublicUrls, getEnvFilePath } from '../utils/env-file.js';
import { writeNetworkRequest, networkRequestPending } from '../utils/network-request.js';
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
    // لا نعيد إنشاء worker حتى لا تنقطع القنوات (FFmpeg أبناء له)
    await execFileAsync('docker', [
      'compose',
      '-f', composeFile,
      '--project-directory', installDir,
      'up', '-d', '--force-recreate', 'api', 'nginx',
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

function envWritable() {
  try {
    fs.accessSync(getEnvFilePath(), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
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
    env_writable: envWritable(),
    os_apply_available: dockerSocketAvailable(),
    request_pending: networkRequestPending(),
    pinned: {
      ip: pinned.pinned_ip || urls.serverIp,
      previous_ip: pinned.previous_ip || null,
      interface_name: pinned.interface_name || null,
      mode: pinned.mode || 'app_only',
      gateway: pinned.gateway || null,
      dns: pinned.dns || null,
      updated_at: pinned.updated_at || null,
    },
    current: urls,
  };
}

function normalizeDns(dns) {
  if (!dns) return null;
  const list = (Array.isArray(dns) ? dns : String(dns).split(','))
    .map((d) => d.trim())
    .filter((d) => isValidIpv4(d));
  return list.length ? list : null;
}

export async function applyServerIp(payload = {}) {
  const {
    ip,
    interface_name: interfaceName,
    mode = 'app_only',
    gateway,
    dns,
    prefix = 24,
  } = payload;

  const previous = await loadServerNetworkSettings();
  const previousIp = getPublicUrls().serverIp;

  // ── DHCP: لا حاجة لـ IP — يطلب من الجهاز التحويل لـ DHCP ثم يكتشف العنوان ──
  if (mode === 'dhcp') {
    if (!dockerSocketAvailable()) {
      throw new Error('تغيير وضع DHCP يتطلب الوصول للجهاز — نفّذ على السيرفر: sudo bash scripts/fix-server-ip.sh --detect');
    }
    const req = writeNetworkRequest({ mode: 'dhcp', interfaceName });
    // مهم: لا نحتفظ بـ pinned_ip في DHCP حتى لا يطغى على العنوان المكتشف الجديد
    await saveServerNetworkSettings({
      mode: 'dhcp',
      pinned_ip: null,
      previous_ip: previousIp,
      interface_name: interfaceName || previous.interface_name || null,
      gateway: null,
      dns: null,
      updated_at: new Date().toISOString(),
    });
    log.info({ interfaceName, written: req.written }, 'DHCP network request queued');
    return {
      ok: true,
      mode: 'dhcp',
      message: req.written
        ? 'تم طلب التحويل إلى DHCP — يُطبَّق على الجهاز خلال ثوانٍ ثم تُحدَّث الروابط تلقائياً'
        : 'تعذّر كتابة الطلب — نفّذ على السيرفر: sudo bash scripts/fix-server-ip.sh --detect',
      previous_ip: previousIp,
      request_written: req.written,
    };
  }

  const trimmed = String(ip || '').trim();
  if (!isValidIpv4(trimmed)) {
    throw new Error('أدخل عنوان IPv4 صحيح (مثل 192.168.1.100)');
  }

  const { interfaces } = await listAvailableInterfaces();
  const matched = interfaces.find((item) => item.address === trimmed);

  // ── static: يثبّت IP جديد على كرت الشبكة (قد يكون غير موجود حالياً) ──
  if (mode === 'static') {
    const gw = String(gateway || '').trim();
    if (!isValidIpv4(gw)) {
      throw new Error('أدخل بوابة (Gateway) صحيحة لوضع IP الثابت');
    }
    const targetInterface = interfaceName || matched?.name;
    if (!targetInterface) {
      throw new Error('اختر كرت الشبكة الذي سيُثبَّت عليه IP');
    }
    if (!dockerSocketAvailable()) {
      throw new Error(`تثبيت IP ثابت يتطلب الوصول للجهاز — نفّذ على السيرفر: sudo bash scripts/fix-server-ip.sh ${trimmed}`);
    }

    const dnsList = normalizeDns(dns);
    const req = writeNetworkRequest({
      mode: 'static',
      ip: trimmed,
      prefix,
      interfaceName: targetInterface,
      gateway: gw,
      dns: dnsList,
    });

    // حدّث .env فوراً ليتطابق مع IP الهدف بمجرد تطبيقه على الكرت
    const envSync = syncEnvPublicUrls(trimmed);
    await saveServerNetworkSettings({
      mode: 'static',
      pinned_ip: trimmed,
      previous_ip: previousIp,
      interface_name: targetInterface,
      gateway: gw,
      dns: dnsList,
      prefix,
      updated_at: new Date().toISOString(),
    });
    await refreshPublicUrlCache({ syncUrls: true });

    log.info({ ip: trimmed, interface: targetInterface, gateway: gw, written: req.written }, 'Static IP request queued');
    return {
      ok: true,
      mode: 'static',
      message: req.written
        ? `تم طلب تثبيت IP ثابت ${trimmed} على ${targetInterface} — يُطبَّق على الجهاز خلال ثوانٍ. قد ينقطع الاتصال مؤقتاً.`
        : `تعذّر كتابة الطلب — نفّذ على السيرفر: sudo bash scripts/fix-server-ip.sh ${trimmed}`,
      ip: trimmed,
      previous_ip: previousIp,
      request_written: req.written,
      env_written: envSync.envWritten,
    };
  }

  // ── app_only: يوجّه التطبيق لكرت موجود فقط (لا يغيّر شبكة الجهاز) ──
  if (!interfaceAllowsIp(interfaces, trimmed)) {
    throw new Error('هذا IP غير موجود على كروت الشبكة — لإضافة IP جديد اختر «ثابت» مع بوابة الشبكة');
  }

  const envSync = syncEnvPublicUrls(trimmed);
  await saveServerNetworkSettings({
    mode: 'app_only',
    pinned_ip: trimmed,
    previous_ip: previousIp,
    interface_name: interfaceName || matched?.name || null,
    gateway: null,
    dns: null,
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
    mode: 'app_only',
    message,
    ip: trimmed,
    previous_ip: previousIp,
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
