import pino from 'pino';
import { config } from '../config/index.js';

const transport = config.env === 'development'
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
  : undefined;

export const logger = pino({
  level: config.log.level,
  transport,
  base: { service: 'streamrelay', serverId: config.serverId },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createChildLogger(module) {
  return logger.child({ module });
}
