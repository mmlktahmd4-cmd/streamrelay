import { useEffect, useState } from 'react';
import { getServerIpConfig, applyServerIp, refreshNetwork } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Network, Check, RefreshCw, AlertCircle, ExternalLink, History } from 'lucide-react';

const sourceLabels = {
  panel: 'مثبّت من اللوحة',
  env: 'ملف .env',
  public_base_url: 'PUBLIC_BASE_URL',
  mikrotik: 'MikroTik',
  auto: 'اكتشاف تلقائي',
};

const MODES = [
  { id: 'app_only', label: 'توجيه فقط', hint: 'يوجّه اللوحة والبث لكرت موجود (لا يغيّر شبكة الجهاز)' },
  { id: 'static', label: 'IP ثابت', hint: 'يثبّت IP على كرت الشبكة (netplan/NetworkManager)' },
  { id: 'dhcp', label: 'تلقائي DHCP', hint: 'يأخذ IP تلقائياً من الراوتر' },
];

function portSuffix(port) {
  return port && port !== 80 ? `:${port}` : '';
}

function clientSubnet(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(parseInt(p, 10)))) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

export default function ServerIp() {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [config, setConfig] = useState(null);
  const [mode, setMode] = useState('app_only');
  const [selectedIp, setSelectedIp] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [gateway, setGateway] = useState('');
  const [dns, setDns] = useState('1.1.1.1, 8.8.8.8');
  const [prefix, setPrefix] = useState(24);
  const [reboot, setReboot] = useState(false);

  const loadConfig = async () => {
    try {
      const { data } = await getServerIpConfig();
      setConfig(data);
      const primary = data.interfaces?.find((item) => item.is_primary) || data.interfaces?.[0];
      setSelectedIp(data.pinned?.ip || data.current?.serverIp || primary?.address || '');
      setSelectedName(data.pinned?.interface_name || primary?.name || '');
      if (data.pinned?.mode) setMode(data.pinned.mode);
      if (data.pinned?.gateway) setGateway(data.pinned.gateway);
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
    if (mode !== 'dhcp' && !selectedIp) {
      setMessage('اختر كرت شبكة أو أدخل IP');
      return;
    }
    const confirmText = {
      app_only: `توجيه اللوحة والبث إلى ${selectedIp}؟`,
      static: `تثبيت IP ثابت ${selectedIp} على ${selectedName}؟\nقد ينقطع الاتصال مؤقتاً أثناء التطبيق.`,
      dhcp: 'التحويل إلى DHCP؟\nسيأخذ الجهاز IP جديد من الراوتر وقد ينقطع الاتصال مؤقتاً.',
    }[mode];
    const rebootWarn = reboot ? '\n\nسيُعاد إقلاع السيرفر بالكامل — تتوقف كل القنوات لمدة دقيقة ثم تعود.' : '';
    if (!confirm(confirmText + rebootWarn)) return;

    setApplying(true);
    setMessage('جاري التطبيق...');
    try {
      const payload = { mode };
      if (mode !== 'dhcp') {
        payload.ip = selectedIp;
        payload.interface_name = selectedName || undefined;
      } else {
        payload.interface_name = selectedName || undefined;
      }
      if (mode === 'static') {
        payload.gateway = gateway.trim();
        payload.prefix = Number(prefix) || 24;
        payload.dns = dns.split(',').map((d) => d.trim()).filter(Boolean);
      }
      payload.reboot = reboot;
      const { data } = await applyServerIp(payload);
      setMessage(data.message || 'تم التطبيق');
      setTimeout(loadConfig, 2000);
    } catch (err) {
      setMessage(err.response?.data?.error || 'تعذّر التطبيق');
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
  const pinned = config?.pinned || {};
  const interfaces = config?.interfaces || [];
  const port = current.webPort || 80;
  const osApply = config?.os_apply_available;

  const detectionHint = config?.docker_detection
    ? 'تم كشف كروت الشبكة من الجهاز'
    : config?.in_container
      ? 'يعرض IP المضبوط — لكشف كامل اربط docker.sock'
      : 'كروت الشبكة من الجهاز مباشرة';

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="page-title flex items-center gap-2">
          <Network className="w-7 h-7 text-cyan-600" />
          IP السيرفر
        </h1>
        <p className="page-subtitle mt-1">
          غيّر IP السيرفر وثبّته — يُطبَّق على روابط البث واللوحة والمشاهدة
        </p>
      </div>

      {message && (
        <div className="card mb-6 p-4 bg-cyan-50 border border-cyan-100 text-sm text-slate-700 whitespace-pre-line">
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
          {pinned.previous_ip && pinned.previous_ip !== current.serverIp && (
            <p className="text-slate-500 flex items-center gap-1">
              <History className="w-3.5 h-3.5" />
              <strong>IP السابق:</strong> <span className="font-mono">{pinned.previous_ip}</span>
            </p>
          )}
          {current.detectedIp && current.detectedIp !== current.serverIp && (
            <p><strong>IP مكتشف على الكرت:</strong> <span className="font-mono">{current.detectedIp}</span></p>
          )}
          <p><strong>رابط HLS:</strong> <span className="font-mono text-xs">{current.hlsBase}</span></p>
          <p>
            <strong>رابط المشاهدة:</strong>{' '}
            {current.viewerUrl ? (
              <a href={current.viewerUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-cyan-700 hover:underline inline-flex items-center gap-1">
                {current.viewerUrl}<ExternalLink className="w-3 h-3" />
              </a>
            ) : '—'}
          </p>
          {pinned.updated_at && (
            <p className="text-slate-500 text-xs">
              آخر تغيير: {new Date(pinned.updated_at).toLocaleString('ar')}
              {pinned.mode ? ` · الوضع: ${MODES.find((m) => m.id === pinned.mode)?.label || pinned.mode}` : ''}
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
                على السيرفر: <span className="font-mono">sudo bash scripts/fix-server-ip.sh --detect</span>
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
        <h2 className="font-bold text-slate-800 mb-3">طريقة التطبيق</h2>
        <div className="grid gap-2 sm:grid-cols-3 mb-4">
          {MODES.map((m) => {
            const active = mode === m.id;
            const disabled = (m.id !== 'app_only') && !osApply;
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => setMode(m.id)}
                className={`text-right rounded-xl border p-3 transition-all ${
                  active ? 'border-cyan-500 bg-cyan-50 ring-2 ring-cyan-200' : 'border-slate-200 hover:border-cyan-300'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={disabled ? 'يتطلب الوصول للجهاز (docker.sock)' : ''}
              >
                <p className="font-bold text-slate-800 text-sm">{m.label}</p>
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">{m.hint}</p>
              </button>
            );
          })}
        </div>

        {mode === 'static' && (
          <div className="grid gap-3 sm:grid-cols-3 mb-2">
            <div>
              <label className="block text-xs text-slate-600 mb-1">IP المطلوب</label>
              <input
                value={selectedIp}
                onChange={(e) => setSelectedIp(e.target.value)}
                placeholder="192.168.1.100"
                className="input font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">البوابة (Gateway)</label>
              <input
                value={gateway}
                onChange={(e) => setGateway(e.target.value)}
                placeholder="192.168.1.1"
                className="input font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Prefix</label>
              <input
                type="number" min="1" max="32"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                className="input font-mono"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs text-slate-600 mb-1">DNS (يفصل بينها فاصلة)</label>
              <input
                value={dns}
                onChange={(e) => setDns(e.target.value)}
                placeholder="1.1.1.1, 8.8.8.8"
                className="input font-mono"
              />
            </div>
          </div>
        )}

        {!osApply && mode !== 'app_only' && (
          <p className="text-xs text-amber-700 mt-2">
            تغيير شبكة الجهاز يتطلب الوصول للجهاز — تأكد من تحديث السيرفر بآخر إصدار.
          </p>
        )}
      </div>

      {mode !== 'dhcp' && (
        <div className="card mb-6">
          <h2 className="font-bold text-slate-800 mb-2">معاينة الروابط</h2>
          <div className="bg-slate-50 rounded-lg p-3 text-sm font-mono text-slate-700 space-y-1">
            <p>http://{selectedIp || '…'}{portSuffix(port)}/login</p>
            <p>http://{selectedIp || '…'}{portSuffix(port)}/watch/login</p>
            <p>http://{selectedIp || '…'}{portSuffix(port)}/api/health</p>
          </div>
          {clientSubnet(selectedIp) && (
            <p className="text-xs text-slate-600 mt-3">
              شبكة العملاء (MikroTik) ستُضبط تلقائياً على{' '}
              <span className="font-mono font-bold">{clientSubnet(selectedIp)}</span> — يتطابق سكربت الجدار الناري مع هذا IP.
            </p>
          )}
        </div>
      )}

      <div className="card mb-6">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={reboot}
            onChange={(e) => setReboot(e.target.checked)}
            disabled={!osApply}
            className="mt-1 w-4 h-4 accent-cyan-600"
          />
          <span>
            <span className="font-semibold text-slate-800">أعد إقلاع السيرفر بعد التطبيق</span>
            <span className="block text-xs text-slate-500 mt-1">
              إقلاع كامل لحفظ الإعدادات وتثبيت IP الجديد بشكل نظيف — تتوقف كل القنوات لمدة دقيقة ثم تعود تلقائياً.
              {!osApply && ' (يتطلب الوصول للجهاز — حدّث السيرفر لأحدث إصدار)'}
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleApply}
          disabled={applying || (mode !== 'dhcp' && interfaces.length === 0 && !selectedIp)}
          className="btn btn-primary"
        >
          {applying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {applying ? 'جاري التطبيق...' : (reboot ? 'تطبيق وإعادة إقلاع' : 'تطبيق على السيرفر')}
        </button>
      </div>
    </div>
  );
}
