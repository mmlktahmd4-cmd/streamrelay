import { useState } from 'react';
import { Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import ViewerAccountModal from './ViewerAccountModal';
import { Tv, LogOut, Shield, UserCircle } from 'lucide-react';

export default function ViewerLayout() {
  const { user, logout, isOperator } = useAuth();
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/watch/login');
  };

  return (
    <div className="viewer-theme min-h-screen flex flex-col">
      <header className="viewer-header">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/watch" className="flex items-center gap-3">
            <div className="viewer-logo">
              <Tv className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-bold text-white text-base leading-tight">StreamRelay TV</p>
              <p className="text-[10px] text-teal-400/80 font-medium">بث داخلي آمن</p>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            {isOperator && (
              <Link to="/" className="viewer-header-btn hidden sm:flex">
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

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="viewer-footer">
        البث عبر الشبكة الداخلية — حسابك: <strong>{user?.username}</strong>
      </footer>

      <ViewerAccountModal open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
