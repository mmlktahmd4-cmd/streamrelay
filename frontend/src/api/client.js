import axios from 'axios';
import { clearAuthStorage, getLoginPath, isAdminLoginPage, isViewerLoginPage } from '../utils/authStorage';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// تجديد واحد مشترك — يمنع «عاصفة التجديد» عند فتح عدة قنوات معاً (كانت تسبب خروجاً تلقائياً)
let refreshPromise = null;

function refreshAccessTokenOnce() {
  if (!refreshPromise) {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) {
      return Promise.reject({ _noRefreshToken: true });
    }
    refreshPromise = axios
      .post(`${API_BASE}/auth/refresh`, { refresh_token: refreshToken })
      .then(({ data }) => {
        localStorage.setItem('access_token', data.access_token);
        if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
        return data.access_token;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

function getAccessTokenExpiryMs() {
  try {
    const token = localStorage.getItem('access_token');
    if (!token) return 0;
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Number(payload.exp) * 1000;
  } catch {
    return 0;
  }
}

/** يجدّد التوكن قبل انتهائه — ضروري لرفع الأفلام الكبيرة (>15 دقيقة) */
async function ensureFreshAccessToken(bufferMs = 120_000) {
  const expires = getAccessTokenExpiryMs();
  if (!expires || Date.now() < expires - bufferMs) return;
  await refreshAccessTokenOnce();
}

function isChunkAlreadyReceivedError(err) {
  const msg = String(err?.response?.data?.error || '');
  return err?.response?.status === 400 && /يُتوقع القطعة \d+ وليس/.test(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postUploadChunk(url, form, uploadConfig, onUploadProgress) {
  const maxAttempts = 4;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await ensureFreshAccessToken();
    try {
      return await api.post(url, form, {
        ...uploadConfig,
        onUploadProgress,
      });
    } catch (err) {
      lastErr = err;
      if (isChunkAlreadyReceivedError(err)) return { data: { already_received: true } };

      const status = err?.response?.status;
      const retriable = !status || status >= 500 || status === 408 || status === 429
        || err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK';

      if (!retriable || attempt >= maxAttempts) throw err;
      await sleep(Math.min(8000, 1000 * attempt));
    }
  }

  throw lastErr;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (!original || error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    const url = String(original?.url || '');
    if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
      return Promise.reject(error);
    }

    const reason = error.response?.data?.reason;
    if (reason === 'session_replaced') {
      clearAuthStorage();
      if (!isAdminLoginPage() && !isViewerLoginPage()) {
        window.location.href = getLoginPath('viewer');
      }
      return Promise.reject(error);
    }

    original._retry = true;
    try {
      const token = await refreshAccessTokenOnce();
      original.headers.Authorization = `Bearer ${token}`;
      return api(original);
    } catch (refreshErr) {
      // سجّل الخروج فقط إذا رُفض التوكن فعلاً (401/403) أو لا يوجد توكن —
      // لا تُسجّل الخروج بسبب خطأ شبكة/مهلة/ضغط عابر
      const status = refreshErr?.response?.status;
      const fatal = refreshErr?._noRefreshToken || status === 401 || status === 403;
      if (fatal) {
        clearAuthStorage();
        if (!isAdminLoginPage() && !url.includes('/auth/me')) {
          window.location.href = getLoginPath('admin');
        }
      }
      return Promise.reject(refreshErr);
    }
  }
);

export default api;

// Auth
export const login = (username, password) =>
  api.post('/auth/login', { username, password });

export const getMe = () => api.get('/auth/me');
export const pingPresence = () => api.post('/auth/presence');

// Channels
export const getChannels = (params) => api.get('/channels', { params });
export const getChannel = (id) => api.get(`/channels/${id}`);
export const createChannel = (data) => api.post('/channels', data);
export const updateChannel = (id, data) => api.put(`/channels/${id}`, data);
export const deleteChannel = (id) => api.delete(`/channels/${id}`, { timeout: 120000 });
export const startChannel = (id) => api.post(`/channels/${id}/start`, {}, { timeout: 240000 });
export const stopChannel = (id) => api.post(`/channels/${id}/stop`, {}, { timeout: 120000 });
export const restartChannel = (id) => api.post(`/channels/${id}/restart`, {}, { timeout: 240000 });
export const getPlaybackUrl = (id) => api.get(`/channels/${id}/playback-url`, { timeout: 45000 });

export const getViewerPlaylistUrl = () => `${API_BASE}/channels/playlist.m3u`;

export const downloadViewerPlaylist = async () => {
  const { data } = await api.get('/channels/playlist.m3u', { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'streamrelay-local.m3u';
  a.click();
  URL.revokeObjectURL(url);
};
export const importM3U = (content, options = {}) =>
  api.post('/channels/import/m3u', {
    content,
    category_id: options.category_id,
    is_public: options.is_public,
    on_demand: options.on_demand,
  }, { timeout: 120000 });

export const previewM3UFromUrl = (url) =>
  api.post('/channels/import/m3u/preview', { url }, { timeout: 300000 });

export const importM3USelected = (channels, options = {}) =>
  api.post('/channels/import/m3u/selected', {
    channels,
    category_id: options.category_id,
    is_public: options.is_public,
    on_demand: options.on_demand,
  }, { timeout: 180000 });

export const duplicateChannel = (id) => api.post(`/channels/${id}/duplicate`, {});
export const bulkUpdateChannels = (data) => api.post('/channels/bulk-update', data);
export const bulkStreamAction = (data) => api.post('/channels/bulk-action', data, { timeout: 120000 });
export const bulkDeleteChannels = (data) => api.post('/channels/bulk-delete', data, { timeout: 600000 });
export const getChannelDiagnostics = (id) => api.get(`/channels/${id}/diagnostics`, { timeout: 120000 });
export const runBulkDiagnostics = (data) => api.post('/channels/bulk-diagnostics', data, { timeout: 600000 });
export const fixChannel = (id, force = false) => api.post(`/channels/${id}/fix`, { force }, { timeout: 300000 });
export const runBulkFix = (data) => api.post('/channels/bulk-fix', data, { timeout: 600000 });
export const getCategories = () => api.get('/channels/meta/categories');
export const getChannelLogs = (id, params) => api.get(`/channels/${id}/logs`, { params });

// Categories & Movies
export const getCategoriesFull = () => api.get('/categories');
export const getCategory = (id) => api.get(`/categories/${id}`);
export const createCategory = (data) => api.post('/categories', data);
export const updateCategory = (id, data) => api.put(`/categories/${id}`, data);
export const deleteCategory = (id) => api.delete(`/categories/${id}`);
export const deleteMovie = (id) => api.delete(`/categories/movies/${id}`);
export const updateMovie = (id, data) => api.put(`/categories/movies/${id}`, data);

export const uploadMovie = async (categoryId, file, { name, description, is_public, poster_url, onProgress } = {}) => {
  const CHUNK_SIZE = 8 * 1024 * 1024;
  const uploadConfig = {
    // مهلة لكل قطعة (8MB) — كافية لاتصال بطيء جداً، ومحدودة كي تتعافى عبر إعادة
    // المحاولة بدل التجمّد طويلاً لو تعطّل طلب واحد.
    timeout: 300000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    transformRequest: [(data, headers) => {
      delete headers['Content-Type'];
      return data;
    }],
  };

  await ensureFreshAccessToken();

  const { data: session } = await api.post(`/categories/${categoryId}/movies/upload/session`, {
    filename: file.name,
    total_size: file.size,
    name,
    description,
    is_public: is_public !== false,
    poster_url,
  }, { timeout: 120000 });

  const uploadId = session.upload_id;
  const chunkSize = session.chunk_size || CHUNK_SIZE;
  const totalChunks = session.total_chunks || Math.ceil(file.size / chunkSize);
  const chunkUrl = `/categories/${categoryId}/movies/upload/session/${uploadId}/chunk`;

  try {
    // حلقة ذاتية الإصلاح: نتبع رقم القطعة الذي يؤكّده السيرفر (received_chunks/expected)
    // بدل افتراض التسلسل، فلو ضاعت استجابة أو وردت قطعة خارج الترتيب نستأنف تلقائياً.
    let index = 0;
    let guard = 0;
    const maxIterations = totalChunks * 5 + 20;

    while (index < totalChunks) {
      if (++guard > maxIterations) {
        throw new Error('تعذّر إكمال الرفع بعد عدة محاولات — تحقّق من الاتصال وحاول مجدداً');
      }

      const start = index * chunkSize;
      const blob = file.slice(start, Math.min(start + chunkSize, file.size));
      const form = new FormData();
      form.append('chunk_index', String(index));
      form.append('chunk', blob, `chunk-${index}`);

      const baseBytes = index * chunkSize;
      const res = await postUploadChunk(`${chunkUrl}?index=${index}`, form, uploadConfig, (e) => {
        if (onProgress && e.total) {
          const current = baseBytes + e.loaded;
          onProgress(Math.min(99, Math.round((current / file.size) * 100)));
        }
      });

      const data = res?.data || {};
      // السيرفر يُرجع عدد القطع المستلمة فعلياً — نتبعه (يشمل حالات إعادة المزامنة)
      if (Number.isInteger(data.received_chunks)) {
        index = data.received_chunks;
      } else if (Number.isInteger(data.expected)) {
        index = data.expected;
      } else {
        index += 1;
      }

      if (onProgress) {
        onProgress(Math.min(99, Math.round(((index * chunkSize) / file.size) * 100)));
      }
    }

    await ensureFreshAccessToken();
    const result = await api.post(`/categories/${categoryId}/movies/upload/session/${uploadId}/complete`, {}, {
      timeout: 600000,
    });
    if (onProgress) onProgress(100);
    return result;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 401) {
      err.message = 'انتهت جلسة الدخول أثناء الرفع — سجّل الدخول من جديد وحاول مرة أخرى';
    }
    try {
      await api.delete(`/categories/${categoryId}/movies/upload/session/${uploadId}`);
    } catch { /* ignore cleanup errors */ }
    throw err;
  }
};

// Users
export const getUsers = (params) => api.get('/users', { params });
export const createUser = (data) => api.post('/users', data);
export const updateUser = (id, data) => api.put(`/users/${id}`, data);
export const deleteUser = (id) => api.delete(`/users/${id}`);

// System
export const getDashboard = () => api.get('/dashboard');
export const getBandwidth = () => api.get('/bandwidth');
export const getMetrics = () => api.get('/metrics');
export const getStreamHealth = () => api.get('/health/streams');
export const getActiveStreams = () => api.get('/streams/active');
export const getLogs = (params) => api.get('/logs', { params });
export const getAuditLogs = (params) => api.get('/audit', { params });
export const getHealth = () => api.get('/health');
export const refreshNetwork = () => api.post('/refresh-network');
export const restartServer = () => api.post('/restart', {}, { timeout: 15000 });
export const getNetworkUrls = () => api.get('/network-urls');
export const getServerIpConfig = () => api.get('/server-ip');
export const applyServerIp = (data) => api.put('/server-ip', data);
export const getSiteConfig = () => api.get('/site-config');
export const saveSiteConfig = (data) => api.put('/site-config', data);
export const getSelfUpdate = (force = false) =>
  api.get('/self-update', { params: force ? { force: '1' } : {}, timeout: 45000 });
export const triggerSelfUpdate = () => api.post('/self-update', {});
export const triggerSelfRollback = () => api.post('/self-update/rollback', {});
export const getPublicBranding = () => axios.get(`${API_BASE}/branding`);

// تطبيق الأندرويد (عام — لا يحتاج توكن)
export const getAppInfo = () => axios.get(`${API_BASE}/app/info`);
export const getAppDownloadUrl = () => `${API_BASE}/app/download`;
export const getBrandingSettings = () => api.get('/settings/branding');
export const saveBrandingSettings = (data) => api.put('/settings/branding', data);

export const getStreamingSettings = () => api.get('/settings/streaming');
export const saveStreamingSettings = (data) => api.put('/settings/streaming', data);

export const getServers = (includeInactive = false) => api.get('/servers', {
  params: includeInactive ? { all: 1 } : {},
});
export const createServer = (data) => api.post('/servers', data);
export const provisionServer = (data) => api.post('/servers/provision', data);
export const updateServer = (id, data) => api.put(`/servers/${id}`, data);
export const deleteServer = (id) => api.delete(`/servers/${id}`);
export const suspendServer = (id) => api.post(`/servers/${id}/suspend`);
export const unsuspendServer = (id) => api.post(`/servers/${id}/unsuspend`);
export const syncRemoteServers = () => api.post('/servers/sync-remotes');
export const updateRemoteServer = (id) => api.post(`/servers/${id}/update-remote`);
export const rollbackRemoteServer = (id) => api.post(`/servers/${id}/rollback-remote`);
export const saveServerSsh = (id, data) => api.put(`/servers/${id}/ssh`, data);

// MikroTik
export const getMikrotikInfo = () => api.get('/mikrotik/info');
export const getMikrotikConfig = () => api.get('/mikrotik/config');
export const saveMikrotikConfig = (data) => api.put('/mikrotik/config', data);
export const getMikrotikScripts = () => api.get('/mikrotik/scripts');
export const getIpRules = () => api.get('/mikrotik/ip-rules');
export const createIpRule = (data) => api.post('/mikrotik/ip-rules', data);
export const deleteIpRule = (id) => api.delete(`/mikrotik/ip-rules/${id}`);
