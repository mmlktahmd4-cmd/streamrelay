/**
 * إصلاح output_url لكل قناة حسب سيرفر البث الفعلي (بعد خطأ ربط الكل بالرئيسي)
 * Usage: docker compose exec api node src/scripts/fix-channel-hls-urls.js
 */
import { query } from '../db/pool.js';
import { getServerById, getHlsBaseForServer } from '../services/server.service.js';
import { getPublicUrls } from '../services/public-url.service.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('fix-hls-urls');

async function main() {
  const { hlsBase: masterHls } = getPublicUrls();
  const result = await query(
    `SELECT id, slug, server_id, output_url FROM channels WHERE is_active = true`
  );

  let fixed = 0;
  for (const ch of result.rows) {
    let expected;
    if (ch.server_id) {
      const server = await getServerById(ch.server_id);
      if (!server) continue;
      expected = `${getHlsBaseForServer(server)}/${ch.slug}/index.m3u8`;
    } else {
      expected = `${masterHls}/${ch.slug}/index.m3u8`;
    }

    if (ch.output_url === expected) continue;
    await query('UPDATE channels SET output_url = $1 WHERE id = $2', [expected, ch.id]);
    log.info({ slug: ch.slug, from: ch.output_url, to: expected });
    fixed += 1;
  }

  log.info({ total: result.rows.length, fixed }, 'Done');
  process.exit(0);
}

main().catch((err) => {
  log.fatal({ err }, 'fix-channel-hls-urls failed');
  process.exit(1);
});
