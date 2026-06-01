import { Client } from 'ssh2';

export const REMOTE_SCRIPT_DIR = '/tmp';

export function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

export function normalizeScript(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function connectSsh({ host, port, username, password }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', (err) => reject(new Error(`فشل SSH: ${err.message}`)));
    conn.connect({
      host,
      port: port || 22,
      username,
      password,
      readyTimeout: 30_000,
      tryKeyboard: false,
    });
  });
}

export function uploadScript(conn, remotePath, script) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const stream = sftp.createWriteStream(remotePath, { mode: 0o755 });
      stream.on('error', reject);
      stream.on('close', resolve);
      stream.end(Buffer.from(script, 'utf8'));
    });
  });
}

export function runRemote(conn, command) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      stream.on('data', (chunk) => { stdout += chunk.toString(); });
      stream.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      stream.on('close', (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else {
          const detail = (stderr || stdout).trim().slice(-3000);
          reject(new Error(detail || `فشل الأمر (exit ${code})`));
        }
      });
    });
  });
}

export function buildRunCommand({ username, password, env, scriptPath }) {
  const envExports = Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ');

  const scriptCall = `bash ${scriptPath}`;

  if (username === 'root') {
    return `export ${envExports} && ${scriptCall}`;
  }

  return `export ${envExports} && (echo ${shellQuote(password)} | sudo -S -p '' ${scriptCall} || sudo -n ${scriptCall})`;
}

export async function execRemoteScript({
  host,
  port,
  username,
  password,
  script,
  remotePath,
  env,
  timeoutMs = 600_000,
}) {
  const conn = await connectSsh({ host, port, username, password });
  const timeout = setTimeout(() => {
    conn.end();
  }, timeoutMs);

  try {
    await runRemote(conn, 'uname -a');
    await uploadScript(conn, remotePath, script);
    const command = buildRunCommand({ username, password, env, scriptPath: remotePath });
    return await runRemote(conn, command);
  } finally {
    clearTimeout(timeout);
    conn.end();
  }
}
