import { query } from '../db/pool.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('streaming-config');

export const DEFAULT_STREAMING_CONFIG = {
  // البث متعدد الجودات (Adaptive Bitrate) — مطفأ افتراضياً لأنه يستهلك CPU.
  // فعّله فقط على السيرفر الذي يعاني المشتركون فيه من التقطيع (عادة الداخلي الضعيف).
  abr_enabled: false,
};

function coerce(stored = {}) {
  return {
    abr_enabled: stored.abr_enabled === true,
  };
}

// لا نُخزّن النتيجة في الذاكرة: الحفظ يتم في عملية الـAPI بينما يقرأ هذا الإعداد
// عاملُ البث (worker) في عملية منفصلة، فالكاش يجعل العامل يقرأ قيمة قديمة. تشغيل
// القنوات غير متكرر، فالاستعلام المباشر آمن وبسيط ويضمن أحدث قيمة دائماً.
export async function getStreamingConfig() {
  try {
    const result = await query(`SELECT value FROM settings WHERE key = 'streaming'`);
    return coerce(result.rows[0]?.value || {});
  } catch {
    return { ...DEFAULT_STREAMING_CONFIG };
  }
}

/** قراءة سريعة لا تفشل أبداً — تُستخدم داخل محرك البث */
export async function isAbrEnabled() {
  try {
    const cfg = await getStreamingConfig();
    return cfg.abr_enabled === true;
  } catch {
    return false;
  }
}

export async function saveStreamingConfig(fields = {}) {
  const payload = {
    ...coerce(fields),
    updated_at: new Date().toISOString(),
  };

  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('streaming', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(payload)]
  );

  log.info({ abr_enabled: payload.abr_enabled }, 'Streaming config updated');
  return getStreamingConfig();
}
