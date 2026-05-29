import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { getLoginPath, isAdminLoginPage, setAuthPortal } from './utils/authStorage';
import Layout from './components/Layout';
import ViewerLayout from './components/viewer/ViewerLayout';
import Login from './pages/Login';
import ViewerLogin from './pages/viewer/ViewerLogin';
import ViewerHome from './pages/viewer/ViewerHome';
import ViewerWatch from './pages/viewer/ViewerWatch';
import Dashboard from './pages/Dashboard';
import Channels from './pages/Channels';
import ChannelForm from './pages/ChannelForm';
import Player from './pages/Player';
import Users from './pages/Users';
import Mikrotik from './pages/Mikrotik';
import DomainDns from './pages/DomainDns';
import Settings from './pages/Settings';
import ServersPage from './pages/Servers';
import Categories from './pages/Categories';
import Logs from './pages/Logs';
import LoadingSpinner from './components/ui/LoadingSpinner';
import { ViewerBrandingProvider } from './context/ViewerBrandingContext';

function AdminRoute({ children, minRole }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (user && user.role !== 'viewer') {
      setAuthPortal(user.role);
    }
  }, [user]);
  if (loading) return <LoadingSpinner className="min-h-screen" />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'viewer') return <Navigate to="/login" replace state={{ fromViewer: true }} />;
  if (minRole === 'admin' && user.role !== 'admin') return <Navigate to="/" replace />;
  if (minRole === 'operator' && !['admin', 'operator'].includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function ViewerRoute({ children }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (user?.role === 'viewer') {
      setAuthPortal('viewer');
    }
  }, [user]);
  if (loading) return <LoadingSpinner className="min-h-screen" />;
  if (!user) return <Navigate to="/watch/login" replace />;
  return children;
}

function GuestViewer({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner className="min-h-screen" />;
  // مشاهد مسجل — يذهب للقنوات
  if (user?.role === 'viewer') return <Navigate to="/watch" replace />;
  // مدير/مشغّل — يظهر صفحة دخول المشاهدة (لا يُحوَّل للإدارة)
  return children;
}

function NotFoundRedirect() {
  const location = useLocation();
  if (location.pathname.startsWith('/watch')) {
    return <Navigate to="/watch/login" replace />;
  }
  return <Navigate to={getLoginPath('admin')} replace />;
}

export default function App() {
  return (
    <Routes>
      {/* بوابة المشاهدة — منفصلة عن الإدارة */}
      <Route path="/watch/login" element={<ViewerBrandingProvider><GuestViewer><ViewerLogin /></GuestViewer></ViewerBrandingProvider>} />
      <Route path="/watch" element={<ViewerBrandingProvider><ViewerRoute><ViewerLayout /></ViewerRoute></ViewerBrandingProvider>}>
        <Route index element={<ViewerHome />} />
        <Route path="live/:id" element={<ViewerWatch />} />
      </Route>

      {/* لوحة الإدارة — بدون إعادة توجيه تلقائي */}
      <Route path="/login" element={<Login />} />
      <Route path="/admin/login" element={<Login />} />
      <Route path="/" element={<AdminRoute><Layout /></AdminRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="channels" element={<Channels />} />
        <Route path="categories" element={<AdminRoute minRole="operator"><Categories /></AdminRoute>} />
        <Route path="channels/new" element={<AdminRoute minRole="operator"><ChannelForm /></AdminRoute>} />
        <Route path="channels/:id/edit" element={<AdminRoute minRole="operator"><ChannelForm /></AdminRoute>} />
        <Route path="player/:id" element={<Player />} />
        <Route path="users" element={<AdminRoute minRole="admin"><Users /></AdminRoute>} />
        <Route path="servers" element={<AdminRoute minRole="admin"><ServersPage /></AdminRoute>} />
        <Route path="domain" element={<AdminRoute minRole="admin"><DomainDns /></AdminRoute>} />
        <Route path="settings" element={<AdminRoute minRole="admin"><Settings /></AdminRoute>} />
        <Route path="mikrotik" element={<AdminRoute minRole="admin"><Mikrotik /></AdminRoute>} />
        <Route path="logs" element={<Logs />} />
      </Route>

      <Route path="*" element={<NotFoundRedirect />} />
    </Routes>
  );
}
