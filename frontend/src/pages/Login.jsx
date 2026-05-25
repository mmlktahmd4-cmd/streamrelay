import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAuthErrorHint, getAuthErrorMessage } from '../utils/authErrors';
import { Radio, Tv, Shield } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [errorHint, setErrorHint] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setErrorHint('');
    setLoading(true);
    try {
      const user = await login(username, password);
      navigate(user.role === 'viewer' ? '/watch' : '/');
    } catch (err) {
      setError(getAuthErrorMessage(err, 'admin'));
      setErrorHint(getAuthErrorHint(err, 'admin'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-theme min-h-screen flex">
      {/* لوحة جانبية كلاسيكية */}
      <div className="hidden lg:flex lg:w-[420px] admin-sidebar flex-col justify-center px-12 text-white">
        <div className="w-16 h-16 rounded-xl bg-[#1a6bb5] flex items-center justify-center mb-6 shadow-lg">
          <Radio className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-bold mb-3">StreamRelay</h1>
        <p className="text-blue-200/80 text-lg leading-relaxed mb-8">
          منصة إدارة IPTV احترافية — تحكم كامل بالقنوات والبث الداخلي
        </p>
        <div className="space-y-3 text-sm text-blue-200/60">
          <div className="flex items-center gap-2"><Shield className="w-4 h-4" /> إدارة القنوات والمستخدمين</div>
          <div className="flex items-center gap-2"><Radio className="w-4 h-4" /> بث داخلي Relay</div>
          <div className="flex items-center gap-2"><Tv className="w-4 h-4" /> بوابة مشاهدة منفصلة</div>
        </div>
      </div>

      {/* نموذج الدخول */}
      <div className="flex-1 flex items-center justify-center p-6 bg-[#eef1f6]">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex w-14 h-14 rounded-xl bg-[#1a6bb5] items-center justify-center mb-4">
              <Radio className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">لوحة الإدارة</h1>
          </div>

          <div className="card">
            <h2 className="text-xl font-bold text-slate-800 mb-1">تسجيل الدخول</h2>
            <p className="text-sm text-slate-500 mb-6">أدخل بيانات حساب المدير أو المشغّل</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="admin-alert admin-alert-error">
                  <p>{error}</p>
                  {errorHint && <p className="text-sm mt-2 opacity-90">{errorHint}</p>}
                </div>
              )}

              <div>
                <label className="label">اسم المستخدم</label>
                <input
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                  placeholder="admin"
                />
              </div>

              <div>
                <label className="label">كلمة المرور</label>
                <input
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary w-full py-2.5 mt-2" disabled={loading}>
                {loading ? 'جاري الدخول...' : 'دخول لوحة الإدارة'}
              </button>
            </form>
          </div>

          <p className="text-center mt-5 text-sm text-slate-500">
            تريد المشاهدة فقط؟{' '}
            <Link to="/watch/login" className="text-[#1a6bb5] hover:underline font-semibold">
              بوابة المشاهدة
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
