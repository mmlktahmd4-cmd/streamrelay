import axios from 'axios';
import { clearAuthStorage, getLoginPath, isAdminLoginPage } from '../utils/authStorage';

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

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      const isLoginRequest = String(original?.url || '').includes('/auth/login');
      if (isLoginRequest) {
        return Promise.reject(error);
      }

      original._retry = true;
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_BASE}/auth/refresh`, {
            refresh_token: refreshToken,
          });
          localStorage.setItem('access_token', data.access_token);
          original.headers.Authorization = `Bearer ${data.access_token}`;
          return api(original);
        } catch {
          clearAuthStorage();
          if (!isAdminLoginPage() && !String(original?.url || '').includes('/auth/me')) {
            window.location.href = getLoginPath('admin');
          }
        }
      }
    }
    return Promise.reject(error);
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
export const deleteChannel = (id) => api.delete(`/channels/${id}`);
export const startChannel = (id) => api.post(`/channels/${id}/start`);
export const stopChannel = (id) => api.post(`/channels/${id}/stop`);
export const restartChannel = (id) => api.post(`/channels/${id}/restart`);
export const getPlaybackUrl = (id) => api.get(`/channels/${id}/playback-url`);

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
  }, { timeout: 120000 });

export const duplicateChannel = (id) => api.post(`/channels/${id}/duplicate`, {});
export const bulkUpdateChannels = (data) => api.post('/channels/bulk-update', data);
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

export const uploadMovie = (categoryId, file, { name, description, is_public, poster_url, onProgress } = {}) => {
  const form = new FormData();
  form.append('file', file);
  if (name) form.append('name', name);
  if (description) form.append('description', description);
  if (poster_url) form.append('poster_url', poster_url);
  form.append('is_public', is_public !== false ? 'true' : 'false');

  return api.post(`/categories/${categoryId}/movies/upload`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded * 100) / e.total));
      }
    },
  });
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

// MikroTik
export const getMikrotikInfo = () => api.get('/mikrotik/info');
export const getMikrotikConfig = () => api.get('/mikrotik/config');
export const saveMikrotikConfig = (data) => api.put('/mikrotik/config', data);
export const getMikrotikScripts = () => api.get('/mikrotik/scripts');
export const getIpRules = () => api.get('/mikrotik/ip-rules');
export const createIpRule = (data) => api.post('/mikrotik/ip-rules', data);
export const deleteIpRule = (id) => api.delete(`/mikrotik/ip-rules/${id}`);
