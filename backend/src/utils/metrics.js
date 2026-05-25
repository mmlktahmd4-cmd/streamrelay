import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { createChildLogger } from './logger.js';
import { config } from '../config/index.js';

const log = createChildLogger('metrics');

let prevCpuSnapshot = null;
let cachedCpu = { usage_percent: 0, per_core: [] };
let cachedDisk = null;
let diskFetchedAt = 0;

const DISK_CACHE_MS = 30000;

function sampleCpuUsage() {
  const cpus = os.cpus();
  const perCore = [];
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    const times = cpu.times;
    const idle = times.idle;
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    perCore.push({ idle, total });
    totalIdle += idle;
    totalTick += total;
  }

  if (prevCpuSnapshot) {
    const idleDiff = totalIdle - prevCpuSnapshot.totalIdle;
    const totalDiff = totalTick - prevCpuSnapshot.totalTick;

    if (totalDiff > 0) {
      const usage = Math.round(100 - (100 * idleDiff) / totalDiff);
      cachedCpu.usage_percent = Math.min(100, Math.max(0, usage));

      cachedCpu.per_core = perCore.map((core, i) => {
        const prev = prevCpuSnapshot.perCore[i];
        const coreIdleDiff = core.idle - prev.idle;
        const coreTotalDiff = core.total - prev.total;
        if (coreTotalDiff <= 0) return 0;
        return Math.min(100, Math.max(0, Math.round(100 - (100 * coreIdleDiff) / coreTotalDiff)));
      });
    }
  }

  prevCpuSnapshot = { totalIdle, totalTick, perCore };
}

sampleCpuUsage();
setInterval(sampleCpuUsage, 2000).unref();

function getNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const result = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.internal) continue;
      result.push({
        name,
        address: addr.address,
        family: addr.family,
        mac: addr.mac,
      });
    }
  }

  return result;
}

function getDiskInfo() {
  const now = Date.now();
  if (cachedDisk && now - diskFetchedAt < DISK_CACHE_MS) {
    return cachedDisk;
  }

  try {
    if (process.platform === 'win32') {
      const raw = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk -Filter \\"DriveType=3\\" | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress"',
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      );
      const parsed = JSON.parse(raw || '[]');
      const disks = Array.isArray(parsed) ? parsed : [parsed];
      cachedDisk = disks
        .filter((d) => d && d.DeviceID)
        .map((d) => ({
          mount: d.DeviceID,
          total_bytes: parseInt(d.Size, 10) || 0,
          free_bytes: parseInt(d.FreeSpace, 10) || 0,
          used_bytes: Math.max(0, (parseInt(d.Size, 10) || 0) - (parseInt(d.FreeSpace, 10) || 0)),
        }));
    } else {
      const raw = execSync('df -k -P', { encoding: 'utf8', timeout: 5000 });
      cachedDisk = raw
        .trim()
        .split('\n')
        .slice(1)
        .map((line) => {
          const parts = line.split(/\s+/);
          if (parts.length < 6) return null;
          const total = parseInt(parts[1], 10) * 1024;
          const used = parseInt(parts[2], 10) * 1024;
          const free = parseInt(parts[3], 10) * 1024;
          return {
            mount: parts[5],
            total_bytes: total,
            used_bytes: used,
            free_bytes: free,
          };
        })
        .filter(Boolean);
    }
    diskFetchedAt = now;
  } catch (err) {
    log.warn({ err: err.message }, 'Failed to read disk info');
    cachedDisk = cachedDisk || [];
  }

  return cachedDisk || [];
}

export function getSystemMetrics() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const loadAvg = os.loadavg();
  const procMem = process.memoryUsage();
  const disks = getDiskInfo().map((d) => ({
    ...d,
    usage_percent: d.total_bytes > 0 ? Math.round((d.used_bytes / d.total_bytes) * 100) : 0,
  }));

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    os_type: os.type(),
    os_release: os.release(),
    os_version: os.version?.() || null,
    arch: os.arch(),
    node_version: process.version,
    uptime: os.uptime(),
    app_uptime: process.uptime(),
    cpu: {
      model: cpus[0]?.model || 'Unknown',
      cores: cpus.length,
      usage_percent: cachedCpu.usage_percent,
      per_core: cachedCpu.per_core,
      load_average: loadAvg.map((l) => Math.round(l * 100) / 100),
    },
    memory: {
      total_bytes: totalMem,
      used_bytes: usedMem,
      free_bytes: freeMem,
      usage_percent: Math.round((usedMem / totalMem) * 100),
    },
    process: {
      pid: process.pid,
      rss_bytes: procMem.rss,
      heap_used_bytes: procMem.heapUsed,
      heap_total_bytes: procMem.heapTotal,
    },
    disk: disks,
    network: {
      interfaces: getNetworkInterfaces(),
    },
    timestamp: new Date().toISOString(),
  };
}

export async function probeHlsManifest(slug, maxAgeMs = 30000) {
  const filePath = path.join(config.streaming.hlsDir, slug, 'index.m3u8');

  try {
    const stat = await fs.stat(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    return {
      alive: ageMs <= maxAgeMs,
      age_ms: ageMs,
      path: filePath,
    };
  } catch (err) {
    return { alive: false, age_ms: null, error: err.code || err.message };
  }
}

export async function probeStream(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'StreamRelay-HealthCheck/1.0' },
    });
    clearTimeout(timer);
    return { alive: response.ok, status: response.status, latency_ms: 0 };
  } catch {
    clearTimeout(timer);
    try {
      const start = Date.now();
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': 'StreamRelay-HealthCheck/1.0' },
      });
      const body = await response.text();
      const isHls = body.includes('#EXTM3U') || body.includes('#EXT-X-');
      return {
        alive: response.ok && isHls,
        status: response.status,
        latency_ms: Date.now() - start,
      };
    } catch (err) {
      return { alive: false, status: 0, error: err.message };
    }
  }
}

export function checkProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
