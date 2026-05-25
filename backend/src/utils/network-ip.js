import os from 'os';
import fs from 'fs';

export function isRunningInContainer() {
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

export function isDockerInterface(name) {
  const lower = String(name || '').toLowerCase();
  return lower.startsWith('br-')
    || lower.startsWith('docker')
    || lower.startsWith('veth')
    || lower === 'virbr0';
}

export function isDockerBridgeIp(ip) {
  return /^172\.(1[7-9]|2\d)\./.test(String(ip || '').trim());
}

export function isVpnOrTunnelInterface(name) {
  const lower = String(name || '').toLowerCase();
  return lower.includes('tun')
    || lower.includes('tap')
    || lower.includes('vpn')
    || lower.startsWith('wg')
    || lower.includes('wireguard')
    || lower.startsWith('ppp')
    || lower.includes('nordlynx')
    || lower.includes('openvpn')
    || lower.includes('utun')
    || lower.includes('zerotier')
    || lower.includes('tailscale')
    || lower.includes('hamachi');
}

export function subnetFromIp(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return `${nums[0]}.${nums[1]}.${nums[2]}.0/24`;
}

export function ipInSubnet(ip, cidr) {
  if (!ip || !cidr) return true;

  const [base, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (!base || !Number.isFinite(bits) || bits < 0 || bits > 32) return true;

  const toInt = (parts) => (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );

  const ipParts = ip.split('.').map((p) => parseInt(p, 10));
  const baseParts = base.split('.').map((p) => parseInt(p, 10));
  if (ipParts.length !== 4 || baseParts.length !== 4) return false;
  if (ipParts.some((n) => Number.isNaN(n)) || baseParts.some((n) => Number.isNaN(n))) return false;

  const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
  return (toInt(ipParts) & mask) === (toInt(baseParts) & mask);
}

export function resolveHomeSubnet({
  envSubnet,
  serverIp,
  publicHostname,
  mikrotikSubnet,
  mikrotikServerIp,
} = {}) {
  if (envSubnet?.trim()) return envSubnet.trim();

  for (const value of [mikrotikSubnet, serverIp, publicHostname, mikrotikServerIp]) {
    if (!value) continue;
    const subnet = String(value).includes('/') ? String(value).trim() : subnetFromIp(value);
    if (subnet) return subnet;
  }

  return null;
}

export function detectPhysicalLanIp(homeSubnet = null) {
  const entries = [];

  for (const [name, interfaces] of Object.entries(os.networkInterfaces())) {
    if (isDockerInterface(name) || isVpnOrTunnelInterface(name)) continue;

    for (const net of interfaces || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (isDockerBridgeIp(net.address)) continue;
      if (homeSubnet && !ipInSubnet(net.address, homeSubnet)) continue;
      entries.push({ address: net.address, name });
    }
  }

  if (entries.length === 0) return '127.0.0.1';

  const score = (entry) => {
    let s = 0;
    const ip = entry.address;
    if (ip.startsWith('192.168.')) s += 100;
    else if (ip.startsWith('10.')) s += 10;

    const lower = entry.name.toLowerCase();
    if (lower.includes('wi-fi') || lower.includes('wifi') || lower.includes('wireless')) s += 20;
    if (lower.includes('ethernet') || lower.startsWith('en')) s += 15;
    if (lower.includes('eth')) s += 15;
    return s;
  };

  entries.sort((a, b) => score(b) - score(a));
  return entries[0].address;
}

export function pickServerIpFromHostnameList(rawList) {
  const ips = String(rawList || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return ips.find((ip) => ip.startsWith('192.168.'))
    || ips.find((ip) => ip.startsWith('10.') && !isDockerBridgeIp(ip))
    || ips.find((ip) => !isDockerBridgeIp(ip))
    || ips[0]
    || '127.0.0.1';
}

/** IP السيرفر من .env — للعرض داخل Docker حيث eth0 = 172.18.x */
export function getConfiguredServerIp() {
  const direct = process.env.SERVER_IP?.trim();
  if (direct && !isDockerBridgeIp(direct)) return direct;

  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured && !configured.includes('localhost') && !configured.includes('127.0.0.1')) {
    try {
      const hostname = new URL(configured).hostname;
      if (hostname && !isDockerBridgeIp(hostname)) return hostname;
    } catch { /* ignore */ }
  }

  return null;
}
