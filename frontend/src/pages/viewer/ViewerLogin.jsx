import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getAuthErrorMessage } from '../../utils/authErrors';
import { setAuthPortal } from '../../utils/authStorage';
import { Tv, Shield } from 'lucide-react';

export default function ViewerLogin() {
  const { login, logout, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setAuthPortal('viewer');
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (user && user.role !== 'viewer') {
        logout();
      }
      const profile = await login(username, password);
      if (profile.role !== 'viewer') {
        setError('هذا الحساب للإدارة — استخدم حساب مشاهد');
        logout();
        return;
      }
      navigate('/watch');
    } catch (err) {
      setError(getAuthErrorMessage(err, 'viewer'));
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return <div className="viewer-theme viewer-login-wrap flex items-center justify-center text-slate-400">جاري التحميل...</div>;
  }

  return (
    <div className="viewer-theme viewer-login-wrap">
      <div className="viewer-login-card">
        <div className="text-center mb-8">
          <div className="viewer-logo w-16 h-16 mx-auto mb-4 rounded-2xl">
            <Tv className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">StreamRelay TV</h1>
          <p className="text-slate-400 text-sm mt-2">ادخل بحسابك للمشاهدة</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {user && user.role !== 'viewer' && (
            <div className="viewer-expiry-banner expired text-center text-sm">
              أنت مسجل كـ {user.role === 'admin' ? 'مدير' : 'مشغّل'}. أدخل حساب مشاهد للمتابعة.
            </div>
          )}

          {error && (
            <div className="viewer-expiry-banner expired text-center">{error}</div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-400 mb-1.5">اسم المستخدم</label>
            <input className="viewer-input" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus dir="ltr" placeholder="client001" />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-400 mb-1.5">كلمة المرور</label>
            <input type="password" className="viewer-input" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          <button type="submit" className="viewer-btn-primary mt-2" disabled={loading}>
            {loading ? 'جاري الدخول...' : 'دخول'}
          </button>
        </form>

        <p className="text-center mt-6 text-xs text-slate-500">
          مدير؟ <Link to="/login" className="text-teal-400 hover:underline font-semibold inline-flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> لوحة الإدارة</Link>
        </p>
      </div>
    </div>
  );
}
