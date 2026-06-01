import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { refreshPublicUrlCache, getPublicUrls } from './public-url.service.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('server-restart');

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function refreshNetworkUrls() {
  const urls = await refreshPublicUrlCache({ syncUrls: true });
  return {
    ok: true,
    message: 'تم تحديث IP الجهاز وروابط القنوات',
    urls,
  };
}

export function getNetworkStatus() {
  return {
    urls: getPublicUrls(),
    uptime: process.uptime(),
    pid: process.pid,
  };
}

export function scheduleProcessRestart() {
  const port = config.port;

  if (process.platform === 'win32') {
    const ps = [
      'Start-Sleep -Seconds 2',
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
      'if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }',
      'Start-Sleep -Seconds 1',
      `Set-Location "${backendRoot}"`,
      'npm start',
    ].join('; ');

    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } else {
    spawn('sh', ['-c', [
      'sleep 2',
      `fuser -k ${port}/tcp 2>/dev/null || lsof -ti:${port} | xargs kill -9 2>/dev/null || true`,
      'sleep 1',
      `cd "${backendRoot}" && npm start`,
    ].join('; ')], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }

  setTimeout(() => {
    log.info('Exiting process for scheduled server restart');
    process.exit(0);
  }, 800);
}

export async function restartServer() {
  const refresh = await refreshNetworkUrls();
  scheduleProcessRestart();
  return {
    ...refresh,
    restarting: true,
    message: 'جاري إعادة تشغيل السيرفر...',
  };
}
