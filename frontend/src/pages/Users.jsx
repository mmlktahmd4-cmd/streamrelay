import { useEffect, useState } from 'react';
import { getUsers, createUser, deleteUser, updateUser } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Plus, Trash2, Pencil, Calendar } from 'lucide-react';

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

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({
    username: '', password: '', role: 'viewer', expires_at: addDays(30),
  });

  const fetchUsers = async () => {
    try {
      const { data } = await getUsers();
      setUsers(data.users || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const resetForm = () => {
    setForm({ username: '', password: '', role: 'viewer', expires_at: addDays(30) });
    setEditId(null);
    setShowForm(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        username: form.username,
        password: form.password,
        role: form.role,
        expires_at: form.role === 'viewer' ? new Date(form.expires_at).toISOString() : undefined,
      };
      await createUser(payload);
      resetForm();
      fetchUsers();
    } catch (err) {
      const details = err.response?.data?.details;
      const msg = details
        ? Object.entries(details).map(([k, v]) => `${k}: ${(Array.isArray(v) ? v : [v]).join(', ')}`).join('\n')
        : err.response?.data?.error || 'حدث خطأ';
      alert(msg);
    }
  };

  const handleUpdateExpiry = async (e) => {
    e.preventDefault();
    try {
      await updateUser(editId, {
        password: form.password || undefined,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        is_active: true,
      });
      resetForm();
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'حدث خطأ');
    }
  };

  const startEdit = (u) => {
    setEditId(u.id);
    setShowForm(true);
    setForm({
      username: u.username,
      password: '',
      role: u.role,
      expires_at: u.expires_at
        ? new Date(u.expires_at).toISOString().slice(0, 16)
        : addDays(30),
    });
  };

  const handleDelete = async (id) => {
    if (!confirm('حذف هذا الحساب؟')) return;
    await deleteUser(id);
    fetchUsers();
  };

  const roleLabels = { admin: 'مدير', operator: 'مشغّل', viewer: 'عميل / مشاهد' };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">حسابات العملاء</h1>
          <p className="page-subtitle">مثل MikroTik — اسم مستخدم، كلمة مرور، وتاريخ انتهاء</p>
        </div>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> حساب جديد
        </button>
      </div>

      <div className="admin-alert admin-alert-info mb-5 text-sm">
        كل عميل يدخل بـ <strong>اسم المستخدم</strong> و<strong>كلمة المرور</strong> فقط.
        حدّد <strong>تاريخ الانتهاء</strong> — بعدها لا يستطيع الدخول.
        كل حساب مشاهد يعمل على <strong>جهاز واحد فقط</strong> — تسجيل دخول جديد يلغي الجلسة السابقة.
      </div>

      {showForm && !editId && (
        <form onSubmit={handleCreate} className="card mb-6 space-y-4">
          <h3 className="font-bold text-slate-800">إضافة حساب عميل</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">اسم المستخدم *</label>
              <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required dir="ltr" placeholder="client001" pattern="[a-zA-Z0-9_-]+" />
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
        <form onSubmit={handleUpdateExpiry} className="card mb-6 space-y-4">
          <h3 className="font-bold text-slate-800">تعديل: {form.username}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">كلمة مرور جديدة (اختياري)</label>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} placeholder="اتركه فارغاً للإبقاء" />
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
                <th>الصلاحية</th>
                <th>تاريخ الانتهاء</th>
                <th>الحالة</th>
                <th>آخر دخول</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const exp = formatExpiry(u.expires_at);
                return (
                  <tr key={u.id}>
                    <td className="font-semibold text-slate-800 font-mono">{u.username}</td>
                    <td><span className="admin-tag admin-tag-blue">{roleLabels[u.role] || u.role}</span></td>
                    <td className={`text-xs ${exp.cls}`}>{exp.text}</td>
                    <td>{u.is_active ? <span className="text-emerald-600 font-medium">نشط</span> : <span className="text-red-500">معطّل</span>}</td>
                    <td className="text-slate-400 text-xs">{u.last_login ? new Date(u.last_login).toLocaleString('ar') : '-'}</td>
                    <td className="flex gap-1">
                      {u.role !== 'admin' && (
                        <>
                          <button className="btn-icon" onClick={() => startEdit(u)} title="تعديل"><Pencil className="w-4 h-4" /></button>
                          <button className="btn-icon btn-icon-danger" onClick={() => handleDelete(u.id)} title="حذف"><Trash2 className="w-4 h-4" /></button>
                        </>
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
