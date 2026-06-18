import { useEffect, useState } from 'react';
import { Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useViewerBranding } from '../../context/ViewerBrandingContext';
import { getCategoriesFull } from '../../api/client';
import ViewerAccountModal from './ViewerAccountModal';
import { Tv, LogOut, Shield, UserCircle, LayoutGrid } from 'lucide-react';

export default function ViewerLayout() {
  const { user, logout, isOperator } = useAuth();
  const branding = useViewerBranding();
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    getCategoriesFull().then(({ data }) => setCategories(data || [])).catch(() => {});
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/watch/login');
  };

  return (
    <div className="viewer-theme min-h-screen flex flex-col md:h-[100dvh] md:overflow-hidden">
      <header className="viewer-header shrink-0">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/watch" className="flex items-center gap-3">
            <div className="viewer-logo">
              <Tv className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-white text-base leading-tight">{branding.app_title}</p>
              <p className="text-[10px] text-teal-400/80 font-medium">{branding.app_tagline}</p>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            {isOperator && (
              <Link to="/login" className="viewer-header-btn hidden sm:flex">
                <Shield className="w-4 h-4" /> الإدارة
              </Link>
            )}
            <button type="button" onClick={() => setAccountOpen(true)} className="viewer-header-btn" title="معلومات الحساب">
              <UserCircle className="w-4 h-4" />
              <span className="hidden sm:inline">{user?.username}</span>
            </button>
            <button type="button" onClick={handleLogout} className="viewer-header-btn danger" title="خروج">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex max-w-7xl mx-auto w-full min-h-0 md:overflow-hidden">
        <aside className="viewer-sidebar hidden md:flex md:flex-col w-56 shrink-0 border-l border-slate-800/80 p-4 min-h-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 px-2 shrink-0">الأقسام</p>
          <nav className="space-y-1 flex-1 min-h-0 overflow-y-auto">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className={`viewer-sidebar-link w-full ${activeCategory === 'all' ? 'active' : ''}`}
            >
              <LayoutGrid className="w-4 h-4" />
              كل المحتوى
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`viewer-sidebar-link w-full ${activeCategory === cat.id ? 'active' : ''}`}
              >
                <span className="truncate">{cat.name}</span>
                <span className="text-[10px] text-slate-500 shrink-0">{(cat.total_count || 0)}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 min-h-0 md:overflow-y-auto">
          <div className="md:hidden px-4 pt-4 overflow-x-auto shrink-0">
            <div className="flex gap-2 pb-2">
              <button type="button" onClick={() => setActiveCategory('all')} className={`viewer-chip ${activeCategory === 'all' ? 'active' : ''}`}>الكل</button>
              {categories.map((cat) => (
                <button key={cat.id} type="button" onClick={() => setActiveCategory(cat.id)} className={`viewer-chip ${activeCategory === cat.id ? 'active' : ''}`}>{cat.name}</button>
              ))}
            </div>
          </div>
          <Outlet context={{ activeCategory, setActiveCategory }} />
        </main>
      </div>

      <footer className="viewer-footer shrink-0">
        البث عبر الشبكة الداخلية — حسابك: <strong>{user?.username}</strong>
      </footer>

      <ViewerAccountModal open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
