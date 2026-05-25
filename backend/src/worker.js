import { createChildLogger } from './utils/logger.js';
import { runMigrations } from './db/migrate.js';
import { setupQueueProcessors, closeQueue } from './services/queue.service.js';
import { recoverStreamsOnStartup } from './services/stream-recovery.service.js';

const log = createChildLogger('worker');

async function main() {
  log.info('Starting StreamRelay worker...');

  await runMigrations();
  await setupQueueProcessors();
  await recoverStreamsOnStartup();

  log.info('Worker ready, processing jobs');

  const shutdown = async (signal) => {
    log.info({ signal }, 'Worker shutting down');
    await closeQueue();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
