import os from 'os';
import {
  detectPhysicalLanIp,
  getConfiguredServerIp,
  isDockerBridgeIp,
  isDockerInterface,
  isRunningInContainer,
  isVpnOrTunnelInterface,
} from './network-ip.js';

const INTERFACE_LABELS = {
  eth: 'Ethernet',
  en: 'Ethernet',
  wlan: 'Wi-Fi',
  wifi: 'Wi-Fi',
  wl: 'Wi-Fi',
};

function labelForInterface(name) {
  const lower = String(name || '').toLowerCase();
  for (const [prefix, label] of Object.entries(INTERFACE_LABELS)) {
    if (lower.startsWith(prefix) || lower.includes(prefix)) return label;
  }
  return name;
}

export function listNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const result = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (isDockerInterface(name) || isVpnOrTunnelInterface(name)) continue;

    for (const addr of addrs) {
      if (addr.internal) continue;
      const family = addr.family === 'IPv4' || addr.family === 4 ? 'IPv4' : String(addr.family);
      if (family !== 'IPv4') continue;
      if (isDockerBridgeIp(addr.address)) continue;

      result.push({
        name,
        label: labelForInterface(name),
        address: addr.address,
        family,
        mac: addr.mac,
        is_primary: false,
      });
    }
  }

  const configuredIp = getConfiguredServerIp();
  const physicalIp = detectPhysicalLanIp();
  const serverIp = configuredIp || (physicalIp !== '127.0.0.1' ? physicalIp : null);

  if (serverIp && !isDockerBridgeIp(serverIp)) {
    const idx = result.findIndex((r) => r.address === serverIp);
    if (idx >= 0) {
      result[idx].is_primary = true;
      result[idx].label = `${result[idx].label} (الحالي)`;
    } else {
      result.unshift({
        name: 'configured',
        label: 'IP مضبوط (الحالي)',
        address: serverIp,
        family: 'IPv4',
        mac: null,
        is_primary: true,
      });
    }
  }

  if (isRunningInContainer()) {
    return result.filter((r) => !isDockerBridgeIp(r.address) && r.name !== 'eth0');
  }

  return result.filter((r) => !isDockerBridgeIp(r.address));
}
