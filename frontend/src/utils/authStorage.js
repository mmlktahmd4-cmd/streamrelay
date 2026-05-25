const PORTAL_KEY = 'auth_portal';

export function isAdminLoginPage(pathname = window.location.pathname) {
  return pathname === '/login' || pathname === '/admin/login';
}

export function isViewerLoginPage(pathname = window.location.pathname) {
  return pathname === '/watch/login';
}

export function setAuthPortal(role) {
  localStorage.setItem(PORTAL_KEY, role === 'viewer' ? 'viewer' : 'admin');
}

export function getAuthPortal() {
  return localStorage.getItem(PORTAL_KEY) === 'viewer' ? 'viewer' : 'admin';
}

export function clearAuthStorage() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem(PORTAL_KEY);
}

export function getLoginPath(portal = getAuthPortal()) {
  if (isAdminLoginPage()) return '/login';
  return portal === 'viewer' ? '/watch/login' : '/login';
}
