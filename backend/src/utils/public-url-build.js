export function readHttpPort() {
  const parsed = parseInt(process.env.STREAMRELAY_HTTP_PORT || '80', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 80;
}

export function buildPublicBaseUrl(host, httpPort = readHttpPort(), protocol = 'http') {
  const port = Number(httpPort) || 80;
  const defaultPort = protocol === 'https' ? 443 : 80;
  if (port === defaultPort) return `${protocol}://${host}`;
  return `${protocol}://${host}:${port}`;
}

/** يوحّد PUBLIC_BASE_URL مع STREAMRELAY_HTTP_PORT — مثال: :8080/login */
export function normalizeConfiguredBaseUrl(configured, host, httpPort = readHttpPort()) {
  const trimmed = configured?.trim();

  if (trimmed && !trimmed.includes('localhost') && !trimmed.includes('127.0.0.1')) {
    try {
      const url = new URL(trimmed);
      const protocol = url.protocol.replace(':', '') || 'http';
      const hostname = url.hostname || host;
      const explicitPort = url.port ? parseInt(url.port, 10) : null;
      const port = explicitPort || httpPort;
      return buildPublicBaseUrl(hostname, port, protocol);
    } catch {
      /* fall through */
    }
  }

  return buildPublicBaseUrl(host, httpPort);
}
