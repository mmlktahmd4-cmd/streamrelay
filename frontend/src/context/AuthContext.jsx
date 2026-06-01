import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { login as apiLogin, getMe, pingPresence } from '../api/client';
import { clearAuthStorage, isAdminLoginPage, isViewerLoginPage, setAuthPortal } from '../utils/authStorage';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const AuthContext = createContext(null);

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return null;

  const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refresh_token: refreshToken });
  localStorage.setItem('access_token', data.access_token);
  return data.access_token;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    const onAdminLogin = isAdminLoginPage();
    const onViewerLogin = isViewerLoginPage();
    if (onAdminLogin) {
      setAuthPortal('admin');
    } else if (onViewerLogin) {
      setAuthPortal('viewer');
    }

    const token = localStorage.getItem('access_token');
    const refreshToken = localStorage.getItem('refresh_token');

    if (!token && !refreshToken) {
      setLoading(false);
      return;
    }

    try {
      const { data } = await getMe();
      if (onAdminLogin && data.role === 'viewer') {
        clearAuthStorage();
        setUser(null);
        return;
      }
      setUser(data);
      if (!onAdminLogin && !onViewerLogin) {
        setAuthPortal(data.role);
      }
    } catch {
      if (refreshToken) {
        try {
          await refreshAccessToken();
          const { data } = await getMe();
          if (onAdminLogin && data.role === 'viewer') {
            clearAuthStorage();
            setUser(null);
            return;
          }
          setUser(data);
          if (!onAdminLogin && !onViewerLogin) {
            setAuthPortal(data.role);
          }
          return;
        } catch {
          /* fall through */
        }
      }
      clearAuthStorage();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    if (!user || user.role !== 'viewer') return undefined;
    const ping = () => pingPresence().catch(() => {});
    ping();
    const interval = setInterval(ping, 45000);
    return () => clearInterval(interval);
  }, [user]);

  const login = async (username, password) => {
    const { data } = await apiLogin(username, password);
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    setAuthPortal(data.user.role);
    try {
      const { data: profile } = await getMe();
      setUser(profile);
      return profile;
    } catch {
      setUser(data.user);
      return data.user;
    }
  };

  const logout = () => {
    clearAuthStorage();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin: user?.role === 'admin', isOperator: ['admin', 'operator'].includes(user?.role) }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
