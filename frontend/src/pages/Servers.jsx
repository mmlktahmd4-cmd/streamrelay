import { useEffect, useState } from 'react';
import { getServers, createServer, updateServer, deleteServer, provisionServer, suspendServer, unsuspendServer, syncRemoteServers, updateRemoteServer, saveServerSsh } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Server, Plus, Pencil, Trash2, RefreshCw, Activity, Link2, Settings2, PauseCircle, PlayCircle, CloudDownload } from 'lucide-react';

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
  save_ssh_for_updates: true,
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

function ServerMetricsCard({ server, onEdit, onDelete, onSuspend, onUnsuspend, onUpdateRemote, onEditSsh, busy }) {
  const hs = server.host_stats;
  const statsAge = hs?.collected_at
    ? Math.round((Date.now() - new Date(hs.collected_at).getTime()) / 1000)
    : null;

  return (
    <div className={`card p-4 ${!server.is_active ? 'opacity-60' : server.is_suspended ? 'ring-2 ring-amber-200 bg-amber-50/30' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="font-bold text-slate-800 flex flex-wrap items-center gap-2">
            {server.name}
            {server.is_local && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">هذا الجهاز</span>}
            {server.is_suspended && <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">معلق</span>}
            {!server.is_active && <span className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">معطّل</span>}
          </h3>
          <p className="font-mono text-xs text-slate-500 mt-0.5">{server.hostname} · {server.ip_address || '—'} · {roleLabels[server.role] || server.role}</p>
        </div>
        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${!server.is_active ? 'bg-slate-100 text-slate-500' : server.is_suspended ? 'bg-amber-50 text-amber-800' : server.online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          <span className={`w-2 h-2 rounded-full ${server.is_suspended ? 'bg-amber-500' : server.online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
          {!server.is_active ? 'معطّل' : server.is_suspended ? 'معلق' : server.online ? 'متصل' : 'غير متصل'}
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
          {server.online
            ? (server.is_local
              ? 'لا توجد بيانات موارد — أعد تشغيل api/worker: docker compose restart api worker'
              : server.metadata?.host_stats?.error
                ? `تعذّر قراءة الموارد على البعيد: ${server.metadata.host_stats.error}`
                : 'بانتظار أول تقرير موارد من worker (خلال 30 ثانية) — إن استمر: حدّث السيرفر البعيد من «تحديث الآن»')
            : 'لا توجد بيانات موارد — السيرفر غير متصل (worker لا يرسل heartbeat)'}
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

      {!server.is_local && (
        <div className="text-xs text-slate-600 mb-3 space-y-1 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span>تحديث تلقائي بعد اللوحة:</span>
            {server.metadata?.ssh_configured ? (
              <span className="text-emerald-700 font-semibold">SSH محفوظ ✓</span>
            ) : (
              <span className="text-amber-700 font-semibold">أضف SSH</span>
            )}
          </div>
          {server.metadata?.last_remote_update && (
            <p>
              آخر تحديث:{' '}
              <span className={server.metadata?.last_remote_update_status === 'failed' ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>
                {server.metadata.last_remote_update_status === 'success' ? 'نجح' : 'فشل'}
              </span>
              {' — '}
              {new Date(server.metadata.last_remote_update).toLocaleString('ar')}
            </p>
          )}
        </div>
      )}

      {server.is_suspended && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
          السيرفر معلّق — القنوات المربوطة به لن تُشغَّل حتى ترفع التعليق
        </p>
      )}

      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
        {server.is_active && !server.is_local && !server.is_suspended && (
          <button
            type="button"
            className="btn btn-sm bg-amber-100 text-amber-900 border border-amber-200 hover:bg-amber-200"
            disabled={busy}
            onClick={() => onSuspend(server)}
            title="تعليق السيرفر وإيقاف قنواته"
          >
            <PauseCircle className="w-4 h-4" /> تعليق السيرفر
          </button>
        )}
        {server.is_active && !server.is_local && server.is_suspended && (
          <button
            type="button"
            className="btn btn-sm bg-emerald-100 text-emerald-900 border border-emerald-200 hover:bg-emerald-200"
            disabled={busy}
            onClick={() => onUnsuspend(server)}
          >
            <PlayCircle className="w-4 h-4" /> رفع التعليق
          </button>
        )}
        {server.is_active && !server.is_suspended && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(server)}><Pencil className="w-3.5 h-3.5" /> تعديل</button>
        )}
        {!server.is_local && server.metadata?.ssh_configured && server.is_active && (
          <button
            type="button"
            className="btn btn-secondary btn-sm text-blue-700"
            disabled={busy}
            onClick={() => onUpdateRemote(server)}
          >
            <CloudDownload className="w-3.5 h-3.5" /> تحديث الآن
          </button>
        )}
        {!server.is_local && server.is_active && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onEditSsh(server)}>
            <Settings2 className="w-3.5 h-3.5" /> SSH
          </button>
        )}
        {!server.is_local && server.is_active && (
          <button
            type="button"
            className="btn btn-sm bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
            disabled={busy}
            onClick={() => onDelete(server)}
            title="حذف من اللوحة"
          >
            <Trash2 className="w-4 h-4" /> حذف
          </button>
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
  const [suspendBusy, setSuspendBusy] = useState(null);
  const [message, setMessage] = useState('');
  const [provisionLog, setProvisionLog] = useState('');
  const [sshTarget, setSshTarget] = useState(null);
  const [sshForm, setSshForm] = useState({ ssh_username: 'root', ssh_password: '', ssh_port: 22, auto_remote_update: true });
  const [showInactive, setShowInactive] = useState(false);

  const loadServers = async () => {
    try {
      const { data } = await getServers(showInactive);
      setServers(data.servers || []);
      setCluster(data.cluster || null);
    } catch (err) {
      setMessage(err.response?.data?.error || 'تعذّر تحميل قائمة السيرفرات — أعد تحميل الصفحة');
    }
    setLoading(false);
  };

  useEffect(() => { loadServers(); }, []);

  useEffect(() => {
    loadServers();
  }, [showInactive]);

  useEffect(() => {
    const interval = setInterval(loadServers, 10000);
    return () => clearInterval(interval);
  }, [showInactive]);

  const resetForms = () => {
    setForm(emptyForm);
    setProvision(emptyProvision);
    setEditId(null);
    setMode(null);
    setMessage('');
    setProvisionLog('');
    setSshTarget(null);
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

  const handleDelete = async (server) => {
    const extra = server.current_streams > 0
      ? '\n\nسيتم إيقاف القنوات النشطة على هذا السيرفر تلقائياً.'
      : '';
    if (!confirm(`حذف «${server.name}» من اللوحة؟${extra}\n\nلن يظهر بعد الحذف (يمكن إعادة ربطه لاحقاً).`)) return;
    setSuspendBusy(server.id);
    try {
      const { data } = await deleteServer(server.id);
      setMessage(data?.message || `تم حذف «${server.name}»`);
      loadServers();
    } catch (err) {
      alert(err.response?.data?.error || 'تعذّر الحذف');
    }
    setSuspendBusy(null);
  };

  const handleSuspend = async (server) => {
    const pinned = server.current_streams || 0;
    const msg = pinned > 0
      ? `تعليق «${server.name}»؟\n\nسيتم إيقاف ${pinned} قناة نشطة مربوطة به فوراً.\nالقنوات المثبتة عليه لن تُشغَّل حتى ترفع التعليق.`
      : `تعليق «${server.name}»؟\n\nالقنوات المربوطة به لن تُشغَّل حتى ترفع التعليق.`;
    if (!confirm(msg)) return;

    setSuspendBusy(server.id);
    try {
      const { data } = await suspendServer(server.id);
      const stopped = data.stopped || 0;
      const pinnedTotal = data.pinned_channels || 0;
      setMessage(
        stopped > 0
          ? `تم تعليق «${server.name}» — أُوقفت ${stopped} قناة. ${pinnedTotal} قناة مربوطة بهذا السيرفر.`
          : `تم تعليق «${server.name}». ${pinnedTotal > 0 ? `${pinnedTotal} قناة مربوطة — لن تُشغَّل.` : 'لا توجد قنوات مربوطة.'}`
      );
      loadServers();
    } catch (err) {
      alert(err.response?.data?.error || 'تعذّر تعليق السيرفر');
    }
    setSuspendBusy(null);
  };

  const handleUnsuspend = async (server) => {
    if (!confirm(`رفع التعليق عن «${server.name}»؟\n\nيمكنك بعدها تشغيل القنوات المربوطة به يدوياً.`)) return;

    setSuspendBusy(server.id);
    try {
      await unsuspendServer(server.id);
      setMessage(`تم رفع التعليق عن «${server.name}» — يمكنك تشغيل القنوات الآن.`);
      loadServers();
    } catch (err) {
      alert(err.response?.data?.error || 'تعذّر رفع التعليق');
    }
    setSuspendBusy(null);
  };

  const handleSyncAllRemotes = async () => {
    if (!confirm('تحديث كل السيرفرات البعيدة التي لها بيانات SSH؟\nقد يستغرق عدة دقائق.')) return;
    setSaving(true);
    setMessage('');
    try {
      const { data } = await syncRemoteServers();
      if (data.skipped) {
        setMessage('التحديث التلقائي للبعيد معطّل (AUTO_UPDATE_REMOTES=0)');
      } else {
        setMessage(`تم: ${data.updated || 0} نجح، ${data.failed || 0} فشل من ${data.total || 0}`);
      }
      loadServers();
    } catch (err) {
      setMessage(err.response?.data?.error || 'فشل تحديث السيرفرات البعيدة');
    }
    setSaving(false);
  };

  const handleUpdateRemote = async (server) => {
    if (!confirm(`تحديث «${server.name}» عبر SSH؟`)) return;
    setSuspendBusy(server.id);
    try {
      const { data } = await updateRemoteServer(server.id);
      setMessage(`تم تحديث «${server.name}»`);
      if (data.log) setProvisionLog(data.log);
      loadServers();
    } catch (err) {
      alert(err.response?.data?.error || 'فشل التحديث');
    }
    setSuspendBusy(null);
  };

  const handleEditSsh = (server) => {
    setSshTarget(server);
    setSshForm({
      ssh_username: server.metadata?.ssh_username || 'root',
      ssh_password: '',
      ssh_port: server.metadata?.ssh_port || 22,
      auto_remote_update: server.metadata?.auto_remote_update !== false,
    });
  };

  const handleSaveSsh = async (e) => {
    e.preventDefault();
    if (!sshTarget) return;
    setSaving(true);
    try {
      const payload = { ...sshForm };
      if (!payload.ssh_password) delete payload.ssh_password;
      await saveServerSsh(sshTarget.id, payload);
      setMessage(`تم حفظ SSH لـ «${sshTarget.name}» — سيُحدَّث تلقائياً بعد safe-update`);
      setSshTarget(null);
      loadServers();
    } catch (err) {
      setMessage(err.response?.data?.error || 'فشل حفظ SSH');
    }
    setSaving(false);
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
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={handleSyncAllRemotes}>
            <CloudDownload className="w-4 h-4" /> تحديث السيرفرات البعيدة
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { resetForms(); setMode('provision'); }}>
            <Link2 className="w-4 h-4" /> ربط تلقائي (SSH)
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => { resetForms(); setMode('manual'); }}>
            <Plus className="w-4 h-4" /> إضافة يدوي
          </button>
        </div>
      </div>

      {message && !mode && !sshTarget && (
        <p className={`mb-4 text-sm px-4 py-2 rounded-lg ${message.includes('فشل') || message.includes('تعذّر') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
          {message}
        </p>
      )}

      {cluster && cluster.stream_servers === 0 && (
        <div className="card mb-6 bg-amber-50 border border-amber-200 text-sm text-amber-900">
          لا يوجد سيرفر بث مسجّل — تأكد أن <strong>worker</strong> يعمل على الرئيسي:
          <code className="mx-1 font-mono text-xs">docker compose ps worker</code>
          وأن السيرفر المحلي ليس بدور api-only فقط.
        </div>
      )}

      {cluster && cluster.online_servers === 0 && cluster.stream_servers > 0 && (
        <div className="card mb-6 bg-amber-50 border border-amber-200 text-sm text-amber-900 space-y-2">
          <p>
            يوجد <strong>{cluster.stream_servers}</strong> سيرفر مسجّل لكن لا heartbeat حديث — القنوات على سيرفر بعيد لن تعمل حتى يشتغل worker هناك.
          </p>
          <p className="font-semibold">على السيرفر الرئيسي:</p>
          <code className="block font-mono text-xs bg-white/80 p-2 rounded">docker compose ps worker && docker compose logs worker --tail 25</code>
          <p className="font-semibold">على السيرفر البعيد (SSH):</p>
          <code className="block font-mono text-xs bg-white/80 p-2 rounded">cd /opt/streamrelay && docker compose -f docker-compose.worker-remote.yml ps && docker compose -f docker-compose.worker-remote.yml logs worker --tail 25</code>
          <p className="text-xs">تأكد: POSTGRES_HOST و REDIS_HOST = IP الرئيسي في .env على البعيد</p>
        </div>
      )}

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
            <p className="text-xs text-slate-400">
              {cluster.total_max_streams_online != null && cluster.total_max_streams_online !== cluster.total_max_streams
                ? `${cluster.total_max_streams_online} متاحة الآن (متصل)`
                : 'حد أقصى للبثوث — مسجّلة'}
            </p>
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
          <li><strong>ربط تلقائي:</strong> أدخل IP + SSH — يُحفظ SSH لتحديث السيرفر البعيد تلقائياً بعد <span className="font-mono">safe-update.sh</span> على الرئيسي.</li>
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
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={provision.save_ssh_for_updates !== false}
              onChange={(e) => setProvision({ ...provision, save_ssh_for_updates: e.target.checked })}
              className="rounded border-slate-300 text-blue-600"
            />
            حفظ بيانات SSH للتحديث التلقائي بعد تحديث اللوحة
          </label>
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

      {sshTarget && (
        <form onSubmit={handleSaveSsh} className="card mb-6 space-y-4 max-w-xl border-blue-100">
          <h2 className="font-bold text-slate-800">SSH للتحديث التلقائي — {sshTarget.name}</h2>
          <p className="text-sm text-slate-600">تُستخدم بعد كل <span className="font-mono">safe-update.sh</span> على السيرفر الرئيسي.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="label">اسم مستخدم SSH</span>
              <input className="input mt-1 font-mono" dir="ltr" value={sshForm.ssh_username} onChange={(e) => setSshForm({ ...sshForm, ssh_username: e.target.value })} required />
            </label>
            <label className="block">
              <span className="label">كلمة مرور SSH {sshTarget.metadata?.ssh_configured ? '(اتركها فارغة للإبقاء)' : '*'}</span>
              <input type="password" className="input mt-1 font-mono" dir="ltr" value={sshForm.ssh_password} onChange={(e) => setSshForm({ ...sshForm, ssh_password: e.target.value })} autoComplete="new-password" />
            </label>
            <label className="block">
              <span className="label">منفذ SSH</span>
              <input type="number" min="1" className="input mt-1" value={sshForm.ssh_port} onChange={(e) => setSshForm({ ...sshForm, ssh_port: parseInt(e.target.value, 10) || 22 })} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={sshForm.auto_remote_update} onChange={(e) => setSshForm({ ...sshForm, auto_remote_update: e.target.checked })} className="rounded border-slate-300 text-blue-600" />
            تفعيل التحديث التلقائي لهذا السيرفر
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={saving}>حفظ</button>
            <button type="button" className="btn btn-secondary" onClick={() => setSshTarget(null)}>إلغاء</button>
          </div>
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
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-bold text-slate-800">مراقبة الموارد — كل سيرفر</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded border-slate-300"
              />
              إظهار المحذوفة
            </label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={loadServers}>
              <RefreshCw className="w-4 h-4" /> تحديث
            </button>
          </div>
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
                onSuspend={handleSuspend}
                onUnsuspend={handleUnsuspend}
                onUpdateRemote={handleUpdateRemote}
                onEditSsh={handleEditSsh}
                busy={suspendBusy === server.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
