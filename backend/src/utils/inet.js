/** يتحقق من عنوان IP صالح لعمود Postgres inet */
export function normalizeInet(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.includes('://') || raw.includes(' ')) return null;

  const withPort = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  const candidate = withPort ? withPort[1] : raw.split('/')[0];

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) {
    const parts = candidate.split('.').map((p) => parseInt(p, 10));
    if (parts.every((p) => p >= 0 && p <= 255)) return candidate;
    return null;
  }

  if (/^[0-9a-fA-F:]+$/.test(candidate) && candidate.includes(':')) {
    return candidate;
  }

  return null;
}
