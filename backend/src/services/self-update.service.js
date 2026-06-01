import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('self-update');
const execFileAsync = promisify(execFile);

const REMOTE_CHECK_TTL_MS = 5 * 60 * 1000;
const REMOTE_CHECK_ERROR_TTL_MS = 90 * 1000;
let remoteCheckCache = null;
let remoteCheckCacheAt = 0;

function getInstallDir() {
  return process.env.STREAMRELAY_INSTALL_DIR?.trim() || '/opt/streamrelay';
}

function requestPath() {
  return path.join(getInstallDir(), '.update-request');
}

function statusPath() {
  return path.join(getInstallDir(), '.update-status');
}

function readHeadRef() {
  try {
    const gitDir = path.join(getInstallDir(), '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.slice(4).trim();
      const sha = fs.readFileSync(path.join(gitDir, ref), 'utf8').trim();
      return { sha, ref: ref.replace('refs/heads/', '') };
    }
    return { sha: head.trim(), ref: null };
  } catch {
    return { sha: null, ref: null };
  }
}

function readLocalShaFromStatus() {
  try {
    const last = JSON.parse(fs.readFileSync(statusPath(), 'utf8'));
    const c = String(last?.commit || '').trim();
    const m = c.match(/^([0-9a-f]{7,40})\b/i);
    return m?.[1] || null;
  } catch {
    return null;
  }
}

function readCurrentCommitFull() {
  return readHeadRef().sha || readLocalShaFromStatus();
}

function readCurrentCommit() {
  const sha = readCurrentCommitFull();
  return sha ? sha.slice(0, 7) : null;
}

/** slug: owner/repo */
function readGitHubRepoSlug() {
  const fromEnv = process.env.GITHUB_REPO?.trim();
  if (fromEnv) {
    if (fromEnv.includes('github.com')) {
      return fromEnv
        .replace(/^https:\/\/github\.com\//, '')
        .replace(/^git@github\.com:/, '')
        .replace(/\.git$/, '')
        .replace(/\/$/, '');
    }
    return fromEnv.replace(/\.git$/, '').replace(/\/$/, '');
  }

  try {
    const config = fs.readFileSync(path.join(getInstallDir(), '.git/config'), 'utf8');
    const match = config.match(/url\s*=\s*(?:https:\/\/github\.com\/|git@github\.com:)([^\s#]+)/i);
    if (!match) return null;
    return match[1].trim().replace(/\.git$/, '').replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** HTTPS clone URL لـ git ls-remote */
function readGitRemoteHttpsUrl() {
  const fromEnv = process.env.GITHUB_REPO?.trim();
  if (fromEnv) {
    if (fromEnv.startsWith('https://')) {
      return fromEnv.endsWith('.git') ? fromEnv : `${fromEnv}.git`;
    }
    if (fromEnv.startsWith('git@github.com:')) {
      const slug = fromEnv.replace(/^git@github\.com:/, '').replace(/\.git$/, '');
      return `https://github.com/${slug}.git`;
    }
    if (!fromEnv.includes('/')) return null;
    return `https://github.com/${fromEnv.replace(/\.git$/, '')}.git`;
  }

  const slug = readGitHubRepoSlug();
  return slug ? `https://github.com/${slug}.git` : null;
}

function shasMatch(a, b) {
  if (!a || !b) return false;
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

function dockerSocketAvailable() {
  try {
    return fs.existsSync('/var/run/docker.sock');
  } catch {
    return false;
  }
}

function osApplyAvailable() {
  try {
    fs.accessSync(getInstallDir(), fs.constants.W_OK);
  } catch {
    return false;
  }
  return dockerSocketAvailable();
}

function mapCommit(entry) {
  const message = entry?.commit?.message || '';
  const lines = message.split('\n');
  return {
    hash: entry.sha?.slice(0, 7) || '',
    subject: lines[0]?.trim() || '',
    body: lines.slice(1).join('\n').trim(),
    author: entry.commit?.author?.name || '',
    date: entry.commit?.author?.date || '',
  };
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'StreamRelay-Update-Checker',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchRemoteBranchShaViaGit(remoteUrl, branch) {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-remote', remoteUrl, `refs/heads/${branch}`],
    { timeout: 20000, maxBuffer: 1024 * 64 }
  );
  const line = stdout.trim().split('\n').find((l) => l.includes(`refs/heads/${branch}`));
  return line?.split('\t')[0]?.trim() || null;
}

async function fetchRemoteBranchShaViaApi(repoSlug, branch) {
  const headers = githubHeaders();
  const url = `https://api.github.com/repos/${repoSlug}/commits/${encodeURIComponent(branch)}?per_page=1`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `GitHub HTTP ${res.status}`);
  return data.sha || null;
}

async function fetchCompareDetails(repoSlug, localSha, remoteSha) {
  const headers = githubHeaders();
  const compareUrl = `https://api.github.com/repos/${repoSlug}/compare/${localSha}...${remoteSha}`;
  const res = await fetch(compareUrl, { headers, signal: AbortSignal.timeout(20000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `GitHub HTTP ${res.status}`);

  const rawCommits = Array.isArray(data.commits) ? data.commits : [];
  const commits = rawCommits.map(mapCommit).reverse();
  const behindBy = Number(data.behind_by) || 0;
  const latest = commits[0] || null;

  return {
    behind_by: behindBy,
    ahead_by: Number(data.ahead_by) || 0,
    status: data.status || '',
    commits,
    latest,
    compare_url: data.html_url || `https://github.com/${repoSlug}/compare/${localSha}...${remoteSha}`,
  };
}

export async function checkRemoteUpdates({ force = false } = {}) {
  const now = Date.now();
  const cacheTtl = remoteCheckCache?.check_error
    ? REMOTE_CHECK_ERROR_TTL_MS
    : REMOTE_CHECK_TTL_MS;
  if (!force && remoteCheckCache && (now - remoteCheckCacheAt) < cacheTtl) {
    return remoteCheckCache;
  }

  const repoSlug = readGitHubRepoSlug();
  const remoteUrl = readGitRemoteHttpsUrl();
  const branch = process.env.GITHUB_BRANCH?.trim() || readHeadRef().ref || 'main';
  const localSha = readCurrentCommitFull();

  if (!repoSlug || !localSha) {
    remoteCheckCache = {
      update_available: false,
      check_skipped: true,
      reason: !repoSlug
        ? 'لم يُعثر على مستودع GitHub — أضف GITHUB_REPO في .env'
        : 'لا يمكن قراءة نسخة اللوحة الحالية — تأكد من وجود .git أو نفّذ تحديثاً واحداً',
      repo: repoSlug || null,
      branch,
      local_commit: localSha ? localSha.slice(0, 7) : null,
    };
    remoteCheckCacheAt = now;
    return remoteCheckCache;
  }

  try {
    let remoteSha = null;
    let checkMethod = 'git-ls-remote';

    if (remoteUrl) {
      try {
        remoteSha = await fetchRemoteBranchShaViaGit(remoteUrl, branch);
      } catch (gitErr) {
        log.warn({ err: gitErr.message, remoteUrl, branch }, 'git ls-remote failed, trying GitHub API');
        checkMethod = 'github-api';
      }
    }

    if (!remoteSha) {
      checkMethod = 'github-api';
      remoteSha = await fetchRemoteBranchShaViaApi(repoSlug, branch);
    }

    if (!remoteSha) {
      throw new Error('تعذّر قراءة آخر commit من GitHub');
    }

    const remoteShort = remoteSha.slice(0, 7);

    if (shasMatch(localSha, remoteSha)) {
      remoteCheckCache = {
        update_available: false,
        behind_by: 0,
        ahead_by: 0,
        status: 'identical',
        remote_commit: remoteShort,
        remote_commit_full: remoteSha,
        local_commit: localSha.slice(0, 7),
        local_commit_full: localSha.length >= 40 ? localSha : null,
        repo: repoSlug,
        branch,
        check_method: checkMethod,
        checked_at: new Date().toISOString(),
      };
      remoteCheckCacheAt = now;
      return remoteCheckCache;
    }

    let compare = null;
    try {
      compare = await fetchCompareDetails(repoSlug, localSha, remoteSha);
    } catch (compareErr) {
      log.warn({ err: compareErr.message }, 'Compare API failed — showing update without commit list');
    }

    const behindBy = compare?.behind_by ?? 1;
    const latest = compare?.latest || { hash: remoteShort, subject: 'تحديث جديد على GitHub' };

    remoteCheckCache = {
      update_available: true,
      behind_by: behindBy,
      ahead_by: compare?.ahead_by ?? 0,
      status: compare?.status || 'behind',
      remote_commit: latest.hash || remoteShort,
      remote_commit_full: remoteSha,
      local_commit: localSha.slice(0, 7),
      latest_subject: latest.subject || null,
      latest_body: latest.body || '',
      commits: compare?.commits || [{ hash: remoteShort, subject: latest.subject || 'تحديث جديد' }],
      repo: repoSlug,
      branch,
      compare_url: compare?.compare_url || `https://github.com/${repoSlug}/compare/${localSha.slice(0, 7)}...${branch}`,
      check_method: checkMethod,
      checked_at: new Date().toISOString(),
    };
    remoteCheckCacheAt = now;

    log.info({ repo: repoSlug, branch, behindBy, latest: latest.subject, method: checkMethod }, 'Remote update available');
    return remoteCheckCache;
  } catch (err) {
    log.warn({ err: err.message, repo: repoSlug, branch }, 'Remote update check failed');
    remoteCheckCache = {
      update_available: false,
      check_error: err.message,
      repo: repoSlug,
      branch,
      local_commit: localSha?.slice(0, 7) || null,
      checked_at: new Date().toISOString(),
    };
    remoteCheckCacheAt = now;
    return remoteCheckCache;
  }
}

export async function getUpdateStatus({ force = false } = {}) {
  let last = null;
  try {
    last = JSON.parse(fs.readFileSync(statusPath(), 'utf8'));
  } catch {
    /* لا يوجد تحديث سابق */
  }

  let pending = false;
  try {
    pending = fs.existsSync(requestPath());
  } catch {
    /* ignore */
  }

  const remote = await checkRemoteUpdates({ force });

  return {
    current_commit: readCurrentCommit(),
    current_commit_full: readCurrentCommitFull(),
    pending,
    os_apply_available: osApplyAvailable(),
    last,
    remote,
  };
}

export function triggerSelfUpdate({ branch } = {}) {
  if (!osApplyAvailable()) {
    throw new Error(
      'تحديث اللوحة يتطلب الوصول للجهاز — نفّذ على السيرفر: cd /opt/streamrelay && sudo bash scripts/deploy-update.sh'
    );
  }

  const safeBranch = String(branch || process.env.GITHUB_BRANCH || 'main')
    .replace(/[^a-zA-Z0-9._/-]/g, '')
    .slice(0, 80) || 'main';

  const lines = [
    '# StreamRelay — طلب تحديث اللوحة (يُطبَّق تلقائياً ثم يُحذف)',
    `REQUESTED_AT=${new Date().toISOString()}`,
    `BRANCH=${safeBranch}`,
  ];

  try {
    fs.writeFileSync(requestPath(), `${lines.join('\n')}\n`, { mode: 0o600 });
  } catch (err) {
    throw new Error(`تعذّر كتابة طلب التحديث: ${err.message}`);
  }

  remoteCheckCache = null;
  remoteCheckCacheAt = 0;

  const queued = {
    state: 'queued',
    message: 'تم وضع التحديث في قائمة الانتظار — يبدأ خلال ثوانٍ',
    commit: '',
    at: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(statusPath(), JSON.stringify(queued), { mode: 0o600 });
  } catch {
    /* ignore */
  }

  log.info({ branch: safeBranch }, 'Self-update request queued');

  return {
    ok: true,
    queued: true,
    message:
      'بدأ تنزيل التحديث وتطبيقه — قد تنقطع اللوحة لدقيقة أو أكثر ثم تعود تلقائياً. لا تغلق الصفحة.',
  };
}
