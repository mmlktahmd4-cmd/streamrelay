import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { refreshNetwork } from '../api/client';
import {
  LayoutDashboard, Radio, Users, ScrollText, LogOut, Menu, X, Tv, Router, FolderOpen, Globe, Settings, Server, Network, Smartphone,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'لوحة التحكم', end: true },
  { to: '/channels', icon: Radio, label: 'القنوات' },
  { to: '/categories', icon: FolderOpen, label: 'الأقسام', minRole: 'operator' },
  { to: '/users', icon: Users, label: 'المستخدمين', adminOnly: true },
  { to: '/servers', icon: Server, label: 'سيرفرات البث', adminOnly: true },
  { to: '/settings', icon: Settings, label: 'الإعدادات', adminOnly: true },
  { to: '/server-ip', icon: Network, label: 'IP السيرفر', adminOnly: true },
  { to: '/app', icon: Smartphone, label: 'تطبيق المشاهدة', adminOnly: true },
  { to: '/domain', icon: Globe, label: 'ربط الدومين (DNS)', adminOnly: true },
  { to: '/mikrotik', icon: Router, label: 'ربط MikroTik', adminOnly: true },
  { to: '/logs', icon: ScrollText, label: 'السجلات' },
];

export default function Layout() {
  const { user, logout, isAdmin, isOperator } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (isOperator) {
      refreshNetwork().catch(() => {});
    }
  }, [isOperator]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const filteredNav = navItems.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.minRole === 'operator' && !['admin', 'operator'].includes(user?.role)) return false;
    return true;
  });
  const roleLabels = { admin: 'مدير النظام', operator: 'مشغّل', viewer: 'مشاهد' };

  return (
    <div className="admin-theme h-[100dvh] overflow-hidden flex">
      <aside
        className={`admin-sidebar flex flex-col w-64 shrink-0 h-full text-white overflow-hidden
          fixed inset-y-0 right-0 z-50
          transform transition-transform duration-300
          lg:relative lg:translate-x-0 lg:z-auto ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10 shrink-0">
          <div className="w-10 h-10 rounded-lg bg-[#1a6bb5] flex items-center justify-center shadow-md">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-base leading-tight">StreamRelay</p>
            <p className="text-[11px] text-blue-200/70">لوحة الإدارة</p>
          </div>
          <button className="lg:hidden mr-auto p-1 text-blue-200/70 hover:text-white" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="py-4 flex-1 min-h-0 overflow-y-auto">
          <p className="px-5 mb-2 text-[10px] font-bold uppercase tracking-wider text-blue-200/50">القائمة الرئيسية</p>
          {filteredNav.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `admin-nav-link ${isActive ? 'admin-nav-link-active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <Icon className="w-[18px] h-[18px]" />
              {label}
            </NavLink>
          ))}

          <div className="my-4 mx-5 border-t border-white/10" />
          <Link to="/watch" className="admin-nav-link" onClick={() => setSidebarOpen(false)}>
            <Tv className="w-[18px] h-[18px]" />
            بوابة المشاهدة
          </Link>
        </nav>

        <div className="p-4 border-t border-white/10 shrink-0">
          <div className="flex items-center gap-3 px-2">
            <div className="w-9 h-9 rounded-full bg-[#1a6bb5] flex items-center justify-center text-sm font-bold shrink-0">
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{user?.username}</p>
              <p className="text-[11px] text-blue-200/60">{roleLabels[user?.role] || user?.role}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-blue-200/70 hover:text-white hover:bg-white/10 transition-colors"
              title="تسجيل خروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="lg:hidden shrink-0 flex items-center gap-3 px-4 py-3 bg-white border-b border-[#dde3ea] shadow-sm">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-600">
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-bold text-slate-800">StreamRelay</span>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto p-5 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
