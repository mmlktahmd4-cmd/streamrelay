import fs from 'fs';
import path from 'path';

function getInstallDir() {
  return process.env.STREAMRELAY_INSTALL_DIR?.trim() || '/opt/streamrelay';
}

export function getNetworkRequestPath() {
  const fromEnv = process.env.STREAMRELAY_NETWORK_REQUEST?.trim();
  if (fromEnv) return fromEnv;
  return path.join(getInstallDir(), '.network-request');
}

function escapeValue(value) {
  return String(value ?? '').replace(/[\r\n]/g, ' ').trim();
}

/**
 * يكتب طلب تغيير شبكة على القرص (env-style) ليلتقطه systemd path unit على الجهاز.
 * mode: 'static' | 'dhcp' | 'reboot'
 * reboot: عند true يعيد الجهاز الإقلاع بعد تطبيق الطلب
 */
export function writeNetworkRequest({ mode, ip, prefix, interfaceName, gateway, dns, reboot = false }) {
  const requestPath = getNetworkRequestPath();
  const lines = [
    '# StreamRelay — طلب تغيير شبكة (يُطبَّق تلقائياً ثم يُحذف)',
    `MODE=${escapeValue(mode)}`,
    `INTERFACE=${escapeValue(interfaceName)}`,
    `IP=${escapeValue(ip)}`,
    `PREFIX=${escapeValue(prefix || 24)}`,
    `GATEWAY=${escapeValue(gateway)}`,
    `DNS=${escapeValue(Array.isArray(dns) ? dns.join(',') : dns)}`,
    `REBOOT=${reboot ? '1' : '0'}`,
    `REQUESTED_AT=${new Date().toISOString()}`,
  ];

  try {
    fs.writeFileSync(requestPath, `${lines.join('\n')}\n`, { mode: 0o600 });
    return { written: true, requestPath };
  } catch (err) {
    return { written: false, requestPath, error: err.message };
  }
}

export function networkRequestPending() {
  try {
    return fs.existsSync(getNetworkRequestPath());
  } catch {
    return false;
  }
}
