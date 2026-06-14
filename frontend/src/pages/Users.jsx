import { useEffect, useState } from 'react';
import { getUsers, createUser, deleteUser, updateUser, getSiteConfig } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { copyText } from '../utils/clipboard';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Plus, Trash2, Pencil, Calendar, Users as UsersIcon, Copy, Check, X } from 'lucide-react';

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function formatExpiry(iso) {
  if (!iso) return { text: 'بدون انتهاء', cls: 'text-slate-500' };
  const exp = new Date(iso);
  const now = new Date();
  const days = Math.ceil((exp - now) / (86400000));
  const text = exp.toLocaleString('ar');
  if (days < 0) return { text: `منتهي — ${text}`, cls: 'text-red-600 font-semibold' };
  if (days <= 7) return { text: `${text} (${days} يوم)`, cls: 'text-amber-600 font-semibold' };
  return { text: `${text} (${days} يوم)`, cls: 'text-emerald-600' };
}

const EMPTY_FORM = {
  username: '', full_name: '', password: '', role: 'viewer',
  max_connections: 1, expires_at: addDays(30),
};

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loginBase, setLoginBase] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [created, setCreated] = useState(null);

  const fetchUsers = async () => {
    try {
      const { data } = await getUsers();
      setUsers(data.users || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  useEffect(() => {
    getSiteConfig()
      .then(({ data }) => {
        if (data?.public_domain) {
          setLoginBase(`${data.use_https ? 'https' : 'http'}://${data.public_domain}`);
        } else {
          setLoginBase(window.location.origin);
        }
      })
      .catch(() => setLoginBase(window.location.origin));
  }, []);

  const loginUrl = `${loginBase || window.location.origin}/watch/login`;

  const buildAccountInfo = ({ username, full_name, password, max_connections, expires_at }) => {
    const lines = [];
    if (full_name) lines.push(`الاسم: ${full_name}`);
    lines.push(`رابط الدخول: ${loginUrl}`);
    lines.push(`اسم المستخدم: ${username}`);
    lines.push(`كلمة المرور: ${password || '«التي حددتها عند الإنشاء»'}`);
    lines.push(`عدد الأجهزة: ${max_connections || 1}`);
    lines.push(expires_at
      ? `تاريخ الانتهاء: ${new Date(expires_at).toLocaleString('ar')}`
      : 'تاريخ الانتهاء: بدون');
    return lines.join('\n');
  };

  const copyAccount = async (u, password) => {
    const ok = await copyText(buildAccountInfo({ ...u, password }));
    if (ok) {
      setCopiedId(u.id || 'created');
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      alert('تعذّر النسخ — انسخ يدوياً');
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowForm(false);
  };

  const showError = (err) => {
    const details = err.response?.data?.details;
    const msg = details
      ? Object.entries(details).map(([k, v]) => `${k}: ${(Array.isArray(v) ? v : [v]).join(', ')}`).join('\n')
      : err.response?.data?.error || 'حدث خطأ';
    alert(msg);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        username: form.username,
        full_name: form.full_name || undefined,
        password: form.password,
        role: form.role,
        max_connections: Math.max(1, Number(form.max_connections) || 1),
        expires_at: form.role === 'viewer' ? new Date(form.expires_at).toISOString() : undefined,
      };
      await createUser(payload);
      // احتفظ ببيانات الدخول (مع كلمة المرور) لعرض بطاقة نسخ — لا تُسترجع كلمة المرور لاحقاً
      setCreated({
        id: 'created',
        username: payload.username,
        full_name: form.full_name || '',
        password: form.password,
        max_connections: payload.max_connections,
        expires_at: payload.expires_at || null,
      });
      resetForm();
      fetchUsers();
    } catch (err) {
      showError(err);
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    try {
      await updateUser(editId, {
        full_name: form.full_name || '',
        password: form.password || undefined,
        max_connections: Math.max(1, Number(form.max_connections) || 1),
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        is_active: true,
      });
      resetForm();
      fetchUsers();
    } catch (err) {
      showError(err);
    }
  };

  const startEdit = (u) => {
    setEditId(u.id);
    setShowForm(true);
    setForm({
      username: u.username,
      full_name: u.full_name || '',
      password: '',
      role: u.role,
      max_connections: u.max_connections || 1,
      expires_at: u.expires_at
        ? new Date(u.expires_at).toISOString().slice(0, 16)
        : '',
    });
  };

  const handleDelete = async (u) => {
    if (!confirm(`حذف الحساب "${u.username}"؟`)) return;
    try {
      await deleteUser(u.id);
      fetchUsers();
    } catch (err) {
      showError(err);
    }
  };

  const roleLabels = { admin: 'مدير', operator: 'مشغّل', viewer: 'عميل / مشاهد' };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">حسابات العملاء</h1>
          <p className="page-subtitle">اسم مستخدم، كلمة مرور، اسم صاحب الحساب، عدد الأجهزة، وتاريخ انتهاء</p>
        </div>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> حساب جديد
        </button>
      </div>

      <div className="admin-alert admin-alert-info mb-5 text-sm">
        كل عميل يدخل بـ <strong>اسم المستخدم</strong> و<strong>كلمة المرور</strong>.
        حدّد <strong>عدد الأجهزة</strong> المسموح بها للحساب — تسجيل دخول جهاز إضافي فوق العدد يُخرج أقدم جهاز.
        و<strong>تاريخ الانتهاء</strong> بعده لا يستطيع الدخول.
      </div>

      {created && (
        <div className="admin-alert admin-alert-success mb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm">
              <div className="font-bold mb-1">تم إنشاء الحساب — انسخ بيانات الدخول وأرسلها للعميل الآن</div>
              <div className="text-xs text-slate-600">كلمة المرور لا تظهر بعد إغلاق هذه الرسالة (تُخزَّن مشفّرة).</div>
              <pre className="mt-2 text-xs bg-white/70 rounded-lg p-3 whitespace-pre-wrap font-sans leading-6">{buildAccountInfo(created)}</pre>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <button className="btn btn-primary btn-sm" onClick={() => copyAccount(created, created.password)}>
                {copiedId === 'created' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedId === 'created' ? 'تم النسخ' : 'نسخ'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setCreated(null)}>
                <X className="w-4 h-4" /> إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && !editId && (
        <form onSubmit={handleCreate} className="card mb-6 space-y-4">
          <h3 className="font-bold text-slate-800">إضافة حساب عميل</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">اسم المستخدم *</label>
              <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required dir="ltr" placeholder="client001" pattern="[a-zA-Z0-9_-]+" />
            </div>
            <div>
              <label className="label">اسم صاحب الحساب</label>
              <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="مثال: أحمد محمد" maxLength={120} />
            </div>
            <div>
              <label className="label">كلمة المرور *</label>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
            </div>
            <div>
              <label className="label">الصلاحية</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="viewer">عميل / مشاهد</option>
                <option value="operator">مشغّل</option>
                <option value="admin">مدير</option>
              </select>
            </div>
            <div>
              <label className="label flex items-center gap-1"><UsersIcon className="w-3.5 h-3.5" /> عدد الأجهزة</label>
              <input className="input" type="number" min={1} max={100} value={form.max_connections} onChange={(e) => setForm({ ...form, max_connections: e.target.value })} />
            </div>
            {form.role === 'viewer' && (
              <div>
                <label className="label flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> تاريخ الانتهاء *</label>
                <input className="input" type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} required />
                <div className="flex gap-2 mt-2 flex-wrap">
                  {[[30, '30 يوم'], [90, '3 أشهر'], [180, '6 أشهر'], [365, 'سنة']].map(([d, l]) => (
                    <button key={d} type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...form, expires_at: addDays(d) })}>{l}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary">إنشاء الحساب</button>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>إلغاء</button>
          </div>
        </form>
      )}

      {showForm && editId && (
        <form onSubmit={handleUpdate} className="card mb-6 space-y-4">
          <h3 className="font-bold text-slate-800">تعديل: {form.username}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">اسم صاحب الحساب</label>
              <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="مثال: أحمد محمد" maxLength={120} />
            </div>
            <div>
              <label className="label">كلمة مرور جديدة (اختياري)</label>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} placeholder="اتركه فارغاً للإبقاء" />
            </div>
            <div>
              <label className="label flex items-center gap-1"><UsersIcon className="w-3.5 h-3.5" /> عدد الأجهزة</label>
              <input className="input" type="number" min={1} max={100} value={form.max_connections} onChange={(e) => setForm({ ...form, max_connections: e.target.value })} />
            </div>
            <div>
              <label className="label">تاريخ الانتهاء</label>
              <input className="input" type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary">حفظ</button>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>إلغاء</button>
          </div>
        </form>
      )}

      {loading ? (
        <LoadingSpinner className="py-24" />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>اسم المستخدم</th>
                <th>صاحب الحساب</th>
                <th>الصلاحية</th>
                <th>الأجهزة</th>
                <th>تاريخ الانتهاء</th>
                <th>الحالة</th>
                <th>آخر دخول</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const exp = formatExpiry(u.expires_at);
                const isSelf = currentUser?.id === u.id;
                return (
                  <tr key={u.id}>
                    <td className="font-semibold text-slate-800 font-mono">{u.username}</td>
                    <td className="text-slate-600 text-sm">{u.full_name || '-'}</td>
                    <td><span className="admin-tag admin-tag-blue">{roleLabels[u.role] || u.role}</span></td>
                    <td className="text-slate-600 text-sm">{u.max_connections || 1}</td>
                    <td className={`text-xs ${exp.cls}`}>{exp.text}</td>
                    <td>{u.is_active ? <span className="text-emerald-600 font-medium">نشط</span> : <span className="text-red-500">معطّل</span>}</td>
                    <td className="text-slate-400 text-xs">{u.last_login ? new Date(u.last_login).toLocaleString('ar') : '-'}</td>
                    <td className="flex gap-1">
                      <button className="btn-icon" onClick={() => copyAccount(u)} title="نسخ معلومات الحساب">
                        {copiedId === u.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                      <button className="btn-icon" onClick={() => startEdit(u)} title="تعديل"><Pencil className="w-4 h-4" /></button>
                      {!isSelf && (
                        <button className="btn-icon btn-icon-danger" onClick={() => handleDelete(u)} title="حذف"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
