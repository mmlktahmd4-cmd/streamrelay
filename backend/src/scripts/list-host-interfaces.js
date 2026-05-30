import { listNetworkInterfaces } from '../utils/network-interfaces.js';

const payload = {
  interfaces: listNetworkInterfaces(),
  in_container: false,
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
