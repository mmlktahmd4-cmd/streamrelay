import { useEffect, useState } from 'react';
import { getServers, createServer, updateServer, deleteServer, provisionServer } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Server, Plus, Pencil, Trash2, RefreshCw, Activity, Link2, Settings2 } from 'lucide-react';

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

const emptyProvision = {
  name: '',
  ip_address: '',
  ssh_username: 'root',
  ssh_password: '',
  ssh_port: 22,
  hostname: '',
  max_streams: 100,
};

function LoadBar({ value, colorClass }) {
  const color = colorClass || (value >= 90 ? 'bg-red-500' : value >= 70 ? 'bg-amber-500' : 'bg-emerald-500');
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden min-w-[80px]">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, value || 0)}%` }} />
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatUptime(sec) {
  if (!sec || sec < 60) return `${sec || 0} ث`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} س ${m} د`;
  return `${m} د`;
}

function MetricLine({ label, value, percent, barColor }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-600 mb-1">
        <span>{label}</span>
        <span className="font-semibold text-slate-800">{value != null ? `${value}%` : '—'}</span>
      </div>
      <LoadBar value={percent ?? 0} colorClass={barColor} />
    </div>
  );
}

function ServerMetricsCard({ server, onEdit, onDelete }) {
  const hs = server.host_stats;
  const statsAge = hs?.collected_at
    ? Math.round((Date.now() - new Date(hs.collected_at).getTime()) / 1000)
    : null;

  return (
    <div className={`card p-4 ${!server.is_active ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="font-bold text-slate-800 flex flex-wrap items-center gap-2">
            {server.name}
            {server.is_local && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">هذا الجهاز</span>}
            {!server.is_active && <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">معطّل</span>}
          </h3>
          <p className="font-mono text-xs text-slate-500 mt-0.5">{server.hostname} · {server.ip_address || '—'} · {roleLabels[server.role] || server.role}</p>
        </div>
        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${!server.is_active ? 'bg-slate-100 text-slate-500' : server.online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          <span className={`w-2 h-2 rounded-full ${server.online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
          {!server.is_active ? 'معطّل' : server.online ? 'متصل' : 'غير متصل'}
        </span>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs text-slate-600 mb-1">
          <span>حمل القنوات</span>
          <span className="font-semibold">{server.current_streams}/{server.max_streams}</span>
        </div>
        <LoadBar value={server.load_percent} />
      </div>

      {hs ? (
        <div className="space-y-2.5 mb-3">
          <MetricLine label="المعالج CPU" value={server.cpu_percent} percent={server.cpu_percent} barColor="bg-blue-500" />
          <MetricLine label="الذاكرة RAM" value={server.memory_percent} percent={server.memory_percent} barColor="bg-emerald-500" />
          {server.disk_percent != null && (
            <MetricLine label={`القرص ${hs.disk?.mount || ''}`} value={server.disk_percent} percent={server.disk_percent} barColor="bg-violet-500" />
          )}
        </div>
      ) : (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
          {server.online ? 'بانتظار أول تقرير موارد (خلال 30 ثانية)...' : 'لا توجد بيانات موارد — السيرفر غير متصل'}
        </p>
      )}

      {hs && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-600 border-t border-slate-100 pt-3">
          <span>المعالج:</span>
          <span className="text-slate-800 truncate" title={hs.cpu?.model}>{hs.cpu?.model || '—'}</span>
          <span>الأنوية:</span>
          <span className="text-slate-800">{hs.cpu?.cores ?? '—'}</span>
          <span>Load avg:</span>
          <span className="text-slate-800 font-mono">{hs.cpu?.load_1} / {hs.cpu?.load_5} / {hs.cpu?.load_15}</span>
          <span>الذاكرة:</span>
          <span className="text-slate-800">{formatBytes(hs.memory?.used_bytes)} / {formatBytes(hs.memory?.total_bytes)}</span>
          <span>القرص:</span>
          <span className="text-slate-800">{hs.disk ? `${formatBytes(hs.disk.free_bytes)} متاح` : '—'}</span>
          <span>نظام التشغيل:</span>
          <span className="text-slate-800">{hs.os_type} {hs.arch}</span>
          <span>وقت التشغيل:</span>
          <span className="text-slate-800">{formatUptime(hs.uptime_sec)}</span>
          {statsAge != null && (
            <>
              <span>آخر تحديث:</span>
              <span className={statsAge > 120 ? 'text-amber-600' : 'text-slate-800'}>منذ {statsAge} ث</span>
            </>
          )}
        </div>
      )}

      <div className="flex gap-1 mt-3 pt-3 border-t border-slate-100">
        {server.is_active && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(server)}><Pencil className="w-3.5 h-3.5" /> تعديل</button>
        )}
        {!server.is_local && (
          <button type="button" className="btn btn-secondary btn-sm text-red-600" onClick={() => onDelete(server.id)}><Trash2 className="w-3.5 h-3.5" /></button>
        )}
      </div>
    </div>
  );
}

export default function ServersPage() {
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState([]);
  const [cluster, setCluster] = useState(null);
  const [mode, setMode] = useState(null);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [provision, setProvision] = useState(emptyProvision);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [provisionLog, setProvisionLog] = useState('');

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
    const interval = setInterval(loadServers, 10000);
    return () => clearInterval(interval);
  }, []);

  const resetForms = () => {
    setForm(emptyForm);
    setProvision(emptyProvision);
    setEditId(null);
    setMode(null);
    setMessage('');
    setProvisionLog('');
  };

  const handleEdit = (server) => {
    setEditId(server.id);
    setMode('manual');
    setForm({
      name: server.name || '',
      hostname: server.hostname || '',
      ip_address: server.ip_address || '',
      role: server.role || 'stream-only',
      max_streams: server.max_streams || 100,
      hls_base_url: server.hls_base_url || '',
      public_base_url: server.public_base_url || '',
    });
  };

  const handleManualSave = async (e) => {
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
      resetForms();
      loadServers();
    } catch (err) {
      setMessage(err.response?.data?.error || 'تعذّر الحفظ');
    }
    setSaving(false);
  };

  const handleProvision = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setProvisionLog('');
    try {
      const payload = { ...provision };
      if (!payload.name?.trim()) delete payload.name;
      if (!payload.hostname?.trim()) delete payload.hostname;
      const { data } = await provisionServer(payload);
      setMessage(`تم ربط السيرفر «${data.server?.name}» بنجاح`);
      setProvisionLog(data.log || '');
      resetForms();
      loadServers();
    } catch (err) {
      const msg = err.response?.data?.error || 'فشل الربط التلقائي';
      const logText = err.response?.data?.log;
      setMessage(logText ? `${msg}\n\n${logText}` : msg);
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
            اربط سيرفرات جديدة تلقائياً أو اختر سيرفراً لكل قناة من صفحة القنوات
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => { resetForms(); setMode('provision'); }}>
            <Link2 className="w-4 h-4" /> ربط تلقائي (SSH)
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => { resetForms(); setMode('manual'); }}>
            <Plus className="w-4 h-4" /> إضافة يدوي
          </button>
        </div>
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
            {cluster.avg_cpu_percent != null && (
              <p className="text-xs text-slate-500 mt-2">CPU: {cluster.avg_cpu_percent}% · أقصى {cluster.max_cpu_percent}%</p>
            )}
          </div>
        </div>
      )}

      <div className="card mb-6 bg-blue-50 border border-blue-100 text-sm text-slate-700 leading-relaxed">
        <strong>كيف يعمل؟</strong>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li><strong>ربط تلقائي:</strong> أدخل IP + SSH — النظام ينزّل StreamRelay من GitHub ويشغّل worker على السيرفر البعيد.</li>
          <li><strong>اختيار القناة:</strong> من «إضافة/تعديل قناة» اختر السيرفر أو اترك «تلقائي».</li>
          <li>على السيرفر الرئيسي، فعّل <span className="font-mono">POSTGRES_PUBLISH=0.0.0.0:5432</span> و <span className="font-mono">REDIS_PUBLISH=0.0.0.0:6379</span> في <span className="font-mono">.env</span> ثم أعد التشغيل.</li>
        </ul>
      </div>

      {mode === 'provision' && (
        <form onSubmit={handleProvision} className="card mb-6 space-y-4 max-w-2xl border-emerald-100">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <Link2 className="w-5 h-5 text-emerald-600" /> ربط سيرفر بث تلقائياً
          </h2>
          <p className="text-sm text-slate-600">يتصل عبر SSH، يثبّت Docker، يستنسخ المشروع، ويرفع إعدادات worker تلقائياً.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="label">اسم العرض (اختياري)</span>
              <input className="input mt-1" value={provision.name} onChange={(e) => setProvision({ ...provision, name: e.target.value })} placeholder="سيرفر 2" />
            </label>
            <label className="block">
              <span className="label">IP السيرفر *</span>
              <input className="input mt-1 font-mono" dir="ltr" value={provision.ip_address} onChange={(e) => setProvision({ ...provision, ip_address: e.target.value })} required placeholder="192.168.1.10" />
            </label>
            <label className="block">
              <span className="label">اسم مستخدم SSH *</span>
              <input className="input mt-1 font-mono" dir="ltr" value={provision.ssh_username} onChange={(e) => setProvision({ ...provision, ssh_username: e.target.value })} required />
            </label>
            <label className="block">
              <span className="label">كلمة مرور SSH *</span>
              <input type="password" className="input mt-1 font-mono" dir="ltr" value={provision.ssh_password} onChange={(e) => setProvision({ ...provision, ssh_password: e.target.value })} required autoComplete="new-password" />
            </label>
            <label className="block">
              <span className="label">منفذ SSH</span>
              <input type="number" min="1" className="input mt-1" value={provision.ssh_port} onChange={(e) => setProvision({ ...provision, ssh_port: parseInt(e.target.value, 10) || 22 })} />
            </label>
            <label className="block">
              <span className="label">Hostname (SERVER_ID) — اختياري</span>
              <input className="input mt-1 font-mono" dir="ltr" value={provision.hostname} onChange={(e) => setProvision({ ...provision, hostname: e.target.value })} placeholder="اتركه فارغاً = تلقائي (node-2, node-3...)" />
              <p className="text-xs text-slate-500 mt-1">إذا سبق ربط node-2 وفشل، اترك الحقل فارغاً أو احذف السيرفر المعطّل من الجدول أدناه</p>
            </label>
            <label className="block">
              <span className="label">حد القنوات</span>
              <input type="number" min="1" className="input mt-1" value={provision.max_streams} onChange={(e) => setProvision({ ...provision, max_streams: parseInt(e.target.value, 10) || 100 })} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'جاري الربط...' : 'ربط وتثبيت'}</button>
            <button type="button" className="btn btn-secondary" onClick={resetForms}>إلغاء</button>
          </div>
          {message && (
            <p className={`text-sm whitespace-pre-wrap ${message.includes('فشل') || message.includes('ERROR') || message.includes('FAIL') ? 'text-red-600' : 'text-emerald-700'}`}>
              {message}
            </p>
          )}
          {provisionLog && (
            <pre className="text-xs bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto max-h-48">{provisionLog}</pre>
          )}
        </form>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleManualSave} className="card mb-6 space-y-4 max-w-2xl">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <Settings2 className="w-5 h-5" /> {editId ? 'تعديل سيرفر' : 'إضافة يدوي'}
          </h2>
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
            <button type="button" className="btn btn-secondary" onClick={resetForms}>إلغاء</button>
          </div>
          {message && <p className={`text-sm ${message.includes('تعذّر') ? 'text-red-600' : 'text-emerald-700'}`}>{message}</p>}
        </form>
      )}

      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-slate-800">مراقبة الموارد — كل سيرفر</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadServers}>
            <RefreshCw className="w-4 h-4" /> تحديث
          </button>
        </div>
        {servers.length === 0 ? (
          <p className="text-slate-500 text-center py-8">لا توجد سيرفرات — اربط أول سيرفر بث</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {servers.map((server) => (
              <ServerMetricsCard
                key={server.id}
                server={server}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
