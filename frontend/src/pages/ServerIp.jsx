import { useEffect, useState } from 'react';
import { getServerIpConfig, applyServerIp, refreshNetwork } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Network, Check, RefreshCw, AlertCircle, ExternalLink } from 'lucide-react';

const sourceLabels = {
  panel: 'مثبّت من اللوحة',
  env: 'ملف .env',
  public_base_url: 'PUBLIC_BASE_URL',
  mikrotik: 'MikroTik',
  auto: 'اكتشاف تلقائي',
};

export default function ServerIp() {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [config, setConfig] = useState(null);
  const [selectedIp, setSelectedIp] = useState('');
  const [selectedName, setSelectedName] = useState('');

  const loadConfig = async () => {
    try {
      const { data } = await getServerIpConfig();
      setConfig(data);
      const primary = data.interfaces?.find((item) => item.is_primary) || data.interfaces?.[0];
      const pinned = data.pinned?.ip || data.current?.serverIp || primary?.address || '';
      setSelectedIp(pinned);
      setSelectedName(data.pinned?.interface_name || primary?.name || '');
    } catch {
      setMessage('تعذّر تحميل إعدادات الشبكة');
    }
    setLoading(false);
  };

  useEffect(() => { loadConfig(); }, []);

  const handleSelect = (item) => {
    setSelectedIp(item.address);
    setSelectedName(item.name);
    setMessage('');
  };

  const handleApply = async () => {
    if (!selectedIp) {
      setMessage('اختر كرت شبكة من القائمة');
      return;
    }
    if (!confirm(`تثبيت IP السيرفر على ${selectedIp}؟\nسيتم تحديث روابط القنوات واللوحة.`)) return;

    setApplying(true);
    setMessage('جاري تطبيق IP...');
    try {
      const { data } = await applyServerIp({
        ip: selectedIp,
        interface_name: selectedName || undefined,
      });
      setMessage(data.message || 'تم تطبيق IP');
      await loadConfig();
    } catch (err) {
      setMessage(err.response?.data?.error || 'تعذّر تطبيق IP');
    }
    setApplying(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const { data: net } = await refreshNetwork();
      await loadConfig();
      setMessage(net?.message || 'تم تحديث روابط الشبكة');
    } catch {
      setMessage('تعذّر تحديث الشبكة');
    }
    setRefreshing(false);
  };

  if (loading) return <LoadingSpinner className="py-24" />;

  const current = config?.current || {};
  const interfaces = config?.interfaces || [];
  const detectionHint = config?.docker_detection
    ? 'تم كشف كروت الشبكة من الجهاز (Docker host)'
    : config?.in_container
      ? 'يعرض IP المضبوط — لتفعيل كشف كامل، اربط docker.sock في docker-compose'
      : 'تم كشف كروت الشبكة من الجهاز مباشرة';

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="page-title flex items-center gap-2">
          <Network className="w-7 h-7 text-cyan-600" />
          IP السيرفر
        </h1>
        <p className="page-subtitle mt-1">
          اختر كرت الشبكة المناسب — يُطبَّق على روابط البث واللوحة والمشاهدة
        </p>
      </div>

      {message && (
        <div className="card mb-6 p-4 bg-cyan-50 border border-cyan-100 text-sm text-slate-700">
          {message}
        </div>
      )}

      <div className="card mb-6">
        <h2 className="font-bold text-slate-800 mb-3">الوضع الحالي</h2>
        <div className="text-sm text-slate-700 space-y-2">
          <p>
            <strong>IP المستخدم:</strong>{' '}
            <span className="font-mono">{current.serverIp || '—'}</span>
            {current.source && (
              <span className="text-slate-500 mr-2">({sourceLabels[current.source] || current.source})</span>
            )}
          </p>
          {current.detectedIp && current.detectedIp !== current.serverIp && (
            <p><strong>IP مكتشف:</strong> <span className="font-mono">{current.detectedIp}</span></p>
          )}
          <p><strong>رابط HLS:</strong> <span className="font-mono text-xs">{current.hlsBase}</span></p>
          <p>
            <strong>رابط المشاهدة:</strong>{' '}
            {current.viewerUrl ? (
              <a href={current.viewerUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-cyan-700 hover:underline inline-flex items-center gap-1">
                {current.viewerUrl}
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : '—'}
          </p>
          {config?.pinned?.updated_at && (
            <p className="text-slate-500 text-xs">
              آخر تثبيت من اللوحة: {new Date(config.pinned.updated_at).toLocaleString('ar')}
            </p>
          )}
        </div>
      </div>

      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-bold text-slate-800">كروت الشبكة</h2>
            <p className="text-sm text-slate-500 mt-1">{detectionHint}</p>
          </div>
          <button type="button" onClick={handleRefresh} disabled={refreshing} className="btn btn-secondary shrink-0">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            تحديث القائمة
          </button>
        </div>

        {interfaces.length === 0 ? (
          <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-4 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">لم يُكتشف أي كرت شبكة</p>
              <p className="mt-1 text-amber-800/90">
                على السيرفر نفّذ: <span className="font-mono">sudo bash scripts/fix-server-ip.sh --detect</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {interfaces.map((item) => {
              const active = selectedIp === item.address;
              return (
                <button
                  key={`${item.name}-${item.address}`}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className={`text-right rounded-xl border p-4 transition-all ${
                    active
                      ? 'border-cyan-500 bg-cyan-50 ring-2 ring-cyan-200'
                      : 'border-slate-200 bg-white hover:border-cyan-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-800">{item.label || item.name}</p>
                      <p className="font-mono text-lg text-cyan-700 mt-1">{item.address}</p>
                      <p className="text-xs text-slate-500 mt-1">{item.name}{item.mac ? ` · ${item.mac}` : ''}</p>
                    </div>
                    {active && <Check className="w-5 h-5 text-cyan-600 shrink-0" />}
                    {item.is_primary && !active && (
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full shrink-0">حالي</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="card mb-6">
        <h2 className="font-bold text-slate-800 mb-2">معاينة بعد التطبيق</h2>
        <p className="text-sm text-slate-600 mb-3">
          المنفذ: <span className="font-mono">{current.webPort || 80}</span>
          {!config?.env_writable && (
            <span className="block mt-2 text-amber-700 text-xs">
              ملاحظة: ملف .env غير قابل للكتابة من الحاوية — قد تحتاج تشغيل fix-server-ip.sh على السيرفر.
            </span>
          )}
        </p>
        <div className="bg-slate-50 rounded-lg p-3 text-sm font-mono text-slate-700 space-y-1">
          <p>http://{selectedIp || '…'}{(current.webPort && current.webPort !== 80) ? `:${current.webPort}` : ''}</p>
          <p>http://{selectedIp || '…'}{(current.webPort && current.webPort !== 80) ? `:${current.webPort}` : ''}/api/hls</p>
          <p>http://{selectedIp || '…'}{(current.webPort && current.webPort !== 80) ? `:${current.webPort}` : ''}/watch/login</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleApply}
          disabled={applying || !selectedIp || interfaces.length === 0}
          className="btn btn-primary"
        >
          {applying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {applying ? 'جاري التطبيق...' : 'تطبيق IP على السيرفر'}
        </button>
      </div>
    </div>
  );
}
