#!/usr/bin/env node
/**
 * تحديث كل سيرفرات البث البعيدة عبر SSH (يُستدعى بعد safe-update على الرئيسي)
 * الاستخدام: docker compose exec -T api node src/scripts/sync-remote-workers.js
 */
import { syncAllRemoteWorkers } from '../services/server-remote-update.service.js';

async function main() {
  try {
    const result = await syncAllRemoteWorkers();
    console.log(JSON.stringify(result, null, 2));
    if (result.failed > 0) process.exit(1);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

main();
