import { useEffect, useState } from 'react';
import { getServers, createServer, updateServer, deleteServer } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Server, Plus, Pencil, Trash2, RefreshCw, Activity } from 'lucide-react';

const roleLabels = {
  full: 'كامل (API + بث)',
  'stream-only': 'بث فقط',
  'api-only': 'API فقط',
};

const emptyForm = {
  name: '',
  hostname: '',
  ip_address: '',
  role: 'stream-only',
  max_streams: 100,
  hls_base_url: '',
  public_base_url: '',
};

function LoadBar({ value }) {
  const color = value >= 90 ? 'bg-red-500' : value >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden min-w-[80px]">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, value || 0)}%` }} />
    </div>
  );
}

export default function ServersPage() {
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState([]);
  const [cluster, setCluster] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadServers = async () => {
    try {
      const { data } = await getServers();
      setServers(data.servers || []);
      setCluster(data.cluster || null);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { loadServers(); }, []);

  useEffect(() => {
    const interval = setInterval(loadServers, 15000);
    return () => clearInterval(interval);
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditId(null);
    setShowForm(false);
  };

  const handleEdit = (server) => {
    setEditId(server.id);
    setForm({
      name: server.name || '',
      hostname: server.hostname || '',
      ip_address: server.ip_address || '',
      role: server.role || 'stream-only',
      max_streams: server.max_streams || 100,
      hls_base_url: server.hls_base_url || '',
      public_base_url: server.public_base_url || '',
    });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      if (editId) {
        await updateServer(editId, form);
        setMessage('تم تحديث السيرفر');
      } else {
        await createServer(form);
        setMessage('تم إضافة السيرفر');
      }
      resetForm();
      loadServers();
    } catch (err) {
      setMessage(err.response?.data?.error || 'تعذّر الحفظ');
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('تعطيل هذا السيرفر؟ القنوات المرتبطة ستُوزَّع تلقائياً.')) return;
    try {
      await deleteServer(id);
      loadServers();
    } catch (err) {
      alert(err.response?.data?.error || 'تعذّر الحذف');
    }
  };

  if (loading) return <LoadingSpinner className="py-24" />;

  return (
    <div>
      <div className="mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Server className="w-7 h-7 text-blue-600" />
            سيرفرات البث
          </h1>
          <p className="page-subtitle mt-1">
            أضف سيرفرات متعددة — النظام يوزّع القنوات تلقائياً على الأقل حملاً
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> إضافة سيرفر
        </button>
      </div>

      {cluster && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="admin-stat-card">
            <p className="text-sm text-slate-500">سيرفرات البث</p>
            <p className="text-3xl font-bold text-slate-800">{cluster.online_servers}/{cluster.stream_servers}</p>
            <p className="text-xs text-slate-400">متصل / مسجّل</p>
          </div>
          <div className="admin-stat-card">
            <p className="text-sm text-slate-500">قنوات نشطة</p>
            <p className="text-3xl font-bold text-slate-800">{cluster.total_current_streams}</p>
            <p className="text-xs text-slate-400">عبر كل السيرفرات</p>
          </div>
          <div className="admin-stat-card">
            <p className="text-sm text-slate-500">السعة الكلية</p>
            <p className="text-3xl font-bold text-slate-800">{cluster.total_max_streams}</p>
            <p className="text-xs text-slate-400">حد أقصى للبثوث</p>
          </div>
          <div className="admin-stat-card">
            <p className="text-sm text-slate-500 flex items-center gap-1"><Activity className="w-4 h-4" /> حمل الكلاستر</p>
            <p className="text-3xl font-bold text-slate-800">{cluster.cluster_load_percent}%</p>
            <LoadBar value={cluster.cluster_load_percent} />
          </div>
        </div>
      )}

      <div className="card mb-6 bg-blue-50 border border-blue-100 text-sm text-slate-700 leading-relaxed">
        <strong>كيف يعمل توزيع الحمل؟</strong>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>عند تشغيل قناة، النظام يختار السيرفر <strong>الأقل حملاً</strong> تلقائياً.</li>
          <li>ثبّت StreamRelay على كل جهاز بث مع <span className="font-mono">SERVER_ID</span> فريد (مثل node-2).</li>
          <li>إذا امتلأ سيرفر، أضف سيرفراً جديداً — القنوات الجديدة تذهب له تلقائياً.</li>
          <li>للسيرفرات على أجهزة مختلفة، املأ <strong>رابط HLS</strong> الخاص بكل سيرفر.</li>
        </ul>
      </div>

      {showForm && (
        <form onSubmit={handleSave} className="card mb-6 space-y-4 max-w-2xl">
          <h2 className="font-bold text-slate-800">{editId ? 'تعديل سيرفر' : 'سيرفر جديد'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="label">اسم العرض</span>
              <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="block">
              <span className="label">Hostname (SERVER_ID)</span>
              <input className="input mt-1 font-mono" dir="ltr" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} required disabled={!!editId} placeholder="node-2" />
            </label>
            <label className="block">
              <span className="label">IP السيرفر</span>
              <input className="input mt-1 font-mono" dir="ltr" value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} placeholder="192.168.1.10" />
            </label>
            <label className="block">
              <span className="label">الدور</span>
              <select className="input mt-1" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="stream-only">بث فقط</option>
                <option value="full">كامل</option>
                <option value="api-only">API فقط</option>
              </select>
            </label>
            <label className="block">
              <span className="label">حد القنوات (max streams)</span>
              <input type="number" min="1" className="input mt-1" value={form.max_streams} onChange={(e) => setForm({ ...form, max_streams: parseInt(e.target.value, 10) || 100 })} />
            </label>
            <label className="block sm:col-span-2">
              <span className="label">رابط HLS (اختياري — للسيرفرات البعيدة)</span>
              <input className="input mt-1 font-mono text-sm" dir="ltr" value={form.hls_base_url} onChange={(e) => setForm({ ...form, hls_base_url: e.target.value })} placeholder="http://192.168.1.10/api/hls" />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</button>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>إلغاء</button>
          </div>
          {message && <p className={`text-sm ${message.includes('تعذّر') ? 'text-red-600' : 'text-emerald-700'}`}>{message}</p>}
        </form>
      )}

      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-slate-800">السيرفرات المسجّلة</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadServers}>
            <RefreshCw className="w-4 h-4" /> تحديث
          </button>
        </div>
        {servers.length === 0 ? (
          <p className="text-slate-500 text-center py-8">لا توجد سيرفرات — أضف أول سيرفر بث</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-slate-500 border-b border-slate-100">
                <th className="py-2 font-medium">الاسم</th>
                <th className="py-2 font-medium">Hostname</th>
                <th className="py-2 font-medium">IP</th>
                <th className="py-2 font-medium">الدور</th>
                <th className="py-2 font-medium">الحمل</th>
                <th className="py-2 font-medium">الحالة</th>
                <th className="py-2 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {servers.filter((s) => s.is_active).map((server) => (
                <tr key={server.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-3 font-medium text-slate-800">
                    {server.name}
                    {server.is_local && <span className="mr-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">هذا الجهاز</span>}
                  </td>
                  <td className="py-3 font-mono text-xs">{server.hostname}</td>
                  <td className="py-3 font-mono text-xs">{server.ip_address || '—'}</td>
                  <td className="py-3 text-xs">{roleLabels[server.role] || server.role}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2 min-w-[120px]">
                      <LoadBar value={server.load_percent} />
                      <span className="text-xs text-slate-500 whitespace-nowrap">{server.current_streams}/{server.max_streams}</span>
                    </div>
                  </td>
                  <td className="py-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${server.online ? 'text-emerald-600' : 'text-slate-400'}`}>
                      <span className={`w-2 h-2 rounded-full ${server.online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                      {server.online ? 'متصل' : 'غير متصل'}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex gap-1">
                      <button type="button" className="btn-icon" onClick={() => handleEdit(server)} title="تعديل"><Pencil className="w-4 h-4" /></button>
                      {!server.is_local && (
                        <button type="button" className="btn-icon text-red-500" onClick={() => handleDelete(server.id)} title="حذف"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
