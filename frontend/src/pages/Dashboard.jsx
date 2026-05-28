import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getDashboard, getBandwidth, restartServer, getHealth, refreshNetwork, getSiteConfig, saveSiteConfig } from '../api/client';
import { useAuth } from '../context/AuthContext';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import {
  Radio, Users, Activity, Cpu, HardDrive, AlertTriangle, ArrowLeft,
  Server, Clock, Monitor, Network, Disc, RefreshCw, Power, Wifi, Download, Upload,
} from 'lucide-react';

const iconStyles = {
  brand: { bg: 'bg-blue-50', text: 'text-blue-600' },
  green: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  red: { bg: 'bg-red-50', text: 'text-red-600' },
  yellow: { bg: 'bg-amber-50', text: 'text-amber-600' },
};

function StatCard({ icon: Icon, label, value, sub, color = 'brand' }) {
  const s = iconStyles[color] || iconStyles.brand;
  return (
    <div className="admin-stat-card">
      <div className={`admin-stat-icon ${s.bg}`}>
        <Icon className={`w-6 h-6 ${s.text}`} />
      </div>
      <div>
        <p className="text-sm text-slate-500 font-medium">{label}</p>
        <p className="text-3xl font-bold text-slate-800 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function ProgressBar({ value, color = 'bg-blue-500' }) {
  return (
    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(100, value || 0)}%` }}
      />
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatBitrate(bps) {
  if (!bps || bps <= 0) return '0 Mbps';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

function formatUptime(seconds) {
  if (!seconds) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} يوم ${h} س ${m} د`;
  if (h > 0) return `${h} س ${m} د`;
  return `${m} د`;
}

function platformLabel(platform) {
  const map = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };
  return map[platform] || platform || '-';
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-slate-100 last:border-0 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="font-medium text-slate-800 text-left break-all">{value ?? '-'}</span>
    </div>
  );
}

export default function Dashboard() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [bandwidth, setBandwidth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [networkMsg, setNetworkMsg] = useState('');
  const [siteForm, setSiteForm] = useState({ public_domain: '', use_https: false });
  const [siteSaving, setSiteSaving] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const { data: d } = await getDashboard();
      setData(d);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const { data: net } = await refreshNetwork();
        if (net?.urls) {
          setData((prev) => (prev ? { ...prev, network: net.urls } : prev));
        }
      } catch { /* ignore */ }
      try {
        const { data: site } = await getSiteConfig();
        setSiteForm({
          public_domain: site.public_domain || '',
          use_https: !!site.use_https,
        });
      } catch { /* ignore */ }
      fetchDashboard();
    };
    init();
    const interval = setInterval(fetchDashboard, 5000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  useEffect(() => {
    const fetchBw = async () => {
      try {
        const { data: bw } = await getBandwidth();
        setBandwidth(bw);
      } catch { /* ignore */ }
    };
    fetchBw();
    const interval = setInterval(fetchBw, 1000);
    return () => clearInterval(interval);
  }, []);

  const waitForServer = async (maxMs = 90000) => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        await getHealth();
        return true;
      } catch { /* server down */ }
    }
    return false;
  };

  const handleRestartServer = async () => {
    if (!confirm('إعادة تشغيل السيرفر؟\nسيتم تحديث IP القنوات حسب IP الجهاز الحالي.')) return;
    setRestarting(true);
    setNetworkMsg('جاري إعادة تشغيل السيرفر...');
    try {
      await restartServer();
    } catch {
      /* قد ينقطع الاتصال أثناء الإيقاف — متوقع */
    }
    const ok = await waitForServer();
    if (ok) {
      try {
        const { data: net } = await refreshNetwork();
        setNetworkMsg(net?.message || 'تم إعادة تشغيل السيرفر وتحديث IP القنوات');
        if (net?.urls) setData((prev) => (prev ? { ...prev, network: net.urls } : prev));
      } catch {
        setNetworkMsg('عاد السيرفر للعمل');
      }
      fetchDashboard();
    } else {
      setNetworkMsg('انتهت المهلة — حاول تحديث الصفحة');
    }
    setRestarting(false);
  };

  const handleSaveSiteConfig = async () => {
    setSiteSaving(true);
    setNetworkMsg('جاري حفظ الدومين...');
    try {
      const { data: saved } = await saveSiteConfig(siteForm);
      setSiteForm({
        public_domain: saved.public_domain || '',
        use_https: !!saved.use_https,
      });
      setData((prev) => (prev ? {
        ...prev,
        network: {
          ...(prev.network || {}),
          baseUrl: saved.active_base_url,
          viewerUrl: saved.viewer_url,
          adminUrl: saved.admin_url,
          publicDomain: saved.public_domain,
          useHttps: saved.use_https,
        },
      } : prev));
      setNetworkMsg('تم حفظ الدومين وتحديث الروابط');
      fetchDashboard();
    } catch (err) {
      setNetworkMsg(err.response?.data?.error || 'تعذّر حفظ الدومين');
    }
    setSiteSaving(false);
  };

  if (loading) return <LoadingSpinner className="py-24" />;

  const channels = data?.channels || {};
  const sys = data?.system || {};
  const network = data?.network || {};
  const bw = bandwidth || data?.bandwidth || {};
  const statusLabels = { running: 'نشطة', stopped: 'متوقفة', error: 'خطأ', starting: 'تشغيل', restarting: 'إعادة تشغيل' };
  const primaryDisk = sys.disk?.[0];

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="page-title">لوحة التحكم</h1>
          <p className="page-subtitle">نظرة عامة على حالة النظام والبث</p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={handleRestartServer}
            disabled={restarting}
            className="btn btn-primary shrink-0"
          >
            {restarting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Power className="w-4 h-4" />
            )}
            {restarting ? 'جاري إعادة التشغيل...' : 'إعادة تشغيل السيرفر'}
          </button>
        )}
      </div>

      {(network.serverIp || networkMsg) && (
        <div className="card mb-6 p-4 bg-cyan-50 border border-cyan-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-2">
                <Network className="w-4 h-4 text-cyan-600" /> عناوين البث على الشبكة
              </h2>
              {network.serverIp && (
                <div className="text-sm text-slate-700 space-y-1">
                  <p><strong>IP الجهاز:</strong> <span className="font-mono">{network.serverIp}</span></p>
                  {network.publicDomain && (
                    <p><strong>الدومين العام:</strong> <span className="font-mono">{network.publicDomain}</span></p>
                  )}
                  <p><strong>رابط HLS:</strong> <span className="font-mono text-xs">{network.hlsBase}</span></p>
                  <p><strong>رابط المشاهدة:</strong>{' '}
                    <a href={network.viewerUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-cyan-700 hover:underline">
                      {network.viewerUrl}
                    </a>
                  </p>
                </div>
              )}
              {isAdmin && (
                <div className="mt-4 pt-4 border-t border-cyan-200 space-y-3">
                  <h3 className="text-sm font-bold text-slate-800">ربط دومين (DNS)</h3>
                  <p className="text-xs text-slate-500">
                    وجّه سجل A في DNS إلى IP السيرفر — الروابط العامة ستستخدم الدومين بدل IP.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      dir="ltr"
                      className="input flex-1 font-mono text-sm"
                      placeholder="tv.example.com"
                      value={siteForm.public_domain}
                      onChange={(e) => setSiteForm((prev) => ({ ...prev, public_domain: e.target.value }))}
                    />
                    <label className="inline-flex items-center gap-2 text-sm text-slate-600 shrink-0 px-2">
                      <input
                        type="checkbox"
                        checked={siteForm.use_https}
                        onChange={(e) => setSiteForm((prev) => ({ ...prev, use_https: e.target.checked }))}
                      />
                      HTTPS
                    </label>
                    <button
                      type="button"
                      onClick={handleSaveSiteConfig}
                      disabled={siteSaving || restarting}
                      className="btn btn-primary btn-sm shrink-0"
                    >
                      {siteSaving ? 'جاري الحفظ...' : 'حفظ الدومين'}
                    </button>
                  </div>
                </div>
              )}
              {networkMsg && (
                <p className={`text-xs mt-2 ${restarting ? 'text-amber-700' : 'text-emerald-700'}`}>{networkMsg}</p>
              )}
            </div>
            <button
              type="button"
              onClick={async () => {
                setNetworkMsg('جاري التحديث...');
                try {
                  const { data: net } = await refreshNetwork();
                  setNetworkMsg(net?.message || 'تم التحديث');
                  if (net?.urls) setData((prev) => (prev ? { ...prev, network: net.urls } : prev));
                } catch {
                  setNetworkMsg('تعذّر التحديث');
                }
              }}
              disabled={restarting}
              className="btn btn-secondary btn-sm shrink-0"
            >
              <RefreshCw className="w-4 h-4" /> تحديث IP
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-7 gap-4 mb-6">
        <StatCard icon={Radio} label="القنوات النشطة" value={channels.running || 0} sub={`من ${data?.total_channels || 0} قناة`} color="green" />
        <StatCard icon={AlertTriangle} label="قنوات بها خطأ" value={channels.error || 0} color="red" />
        <StatCard icon={Activity} label="بثوث نشطة" value={data?.active_streams || 0} color="brand" />
        <StatCard
          icon={Download}
          label="سحب (داخل)"
          value={formatBitrate(bw.total_pull_bps)}
          sub={bw.total_pull_session_bytes ? formatBytes(bw.total_pull_session_bytes) : 'من المصدر'}
          color="yellow"
        />
        <StatCard
          icon={Upload}
          label="بث خارج (خروج)"
          value={formatBitrate(bw.total_egress_bps)}
          sub={bw.total_egress_session_bytes ? formatBytes(bw.total_egress_session_bytes) : 'للمشاهدين'}
          color="red"
        />
        <StatCard icon={Wifi} label="مشاهدون متصلون" value={data?.online_users || 0} sub="جهاز واحد لكل حساب" color="green" />
        <StatCard icon={Users} label="إجمالي الحسابات" value={data?.active_users || 0} color="brand" />
      </div>

      {(bw.channels?.length > 0) && (
        <div className="card mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-600" /> استهلاك البث — القنوات الشغالة
            </h2>
            <span className="text-xs text-emerald-600 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              تحديث كل ثانية
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-slate-500 border-b border-slate-100">
                  <th className="py-2 font-medium">القناة</th>
                  <th className="py-2 font-medium">المعرّف</th>
                  <th className="py-2 font-medium">سحب (داخل)</th>
                  <th className="py-2 font-medium">بث خارج (خروج)</th>
                  <th className="py-2 font-medium">سحب — الجلسة</th>
                  <th className="py-2 font-medium">خروج — الجلسة</th>
                </tr>
              </thead>
              <tbody>
                {bw.channels.map((ch) => (
                  <tr key={ch.channel_id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 font-medium text-slate-800">{ch.name || ch.slug}</td>
                    <td className="py-2.5 font-mono text-xs text-slate-500">{ch.slug}</td>
                    <td className="py-2.5">
                      <span className={`font-bold ${ch.pull_bps > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                        {formatBitrate(ch.pull_bps ?? ch.bps)}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <span className={`font-bold ${ch.egress_bps > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        {formatBitrate(ch.egress_bps)}
                      </span>
                    </td>
                    <td className="py-2.5 text-slate-600">{formatBytes(ch.pull_session_bytes ?? ch.session_bytes)}</td>
                    <td className="py-2.5 text-slate-600">{formatBytes(ch.egress_session_bytes)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50">
                  <td colSpan={2} className="py-2.5 font-bold text-slate-700">الإجمالي</td>
                  <td className="py-2.5 font-bold text-amber-700">{formatBitrate(bw.total_pull_bps)}</td>
                  <td className="py-2.5 font-bold text-red-600">{formatBitrate(bw.total_egress_bps)}</td>
                  <td className="py-2.5 font-bold text-slate-700">{formatBytes(bw.total_pull_session_bytes)}</td>
                  <td className="py-2.5 font-bold text-slate-700">{formatBytes(bw.total_egress_session_bytes)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100 space-y-1">
            {(bw.host_rx_bps > 0) && (
              <p>
                استقبال الشبكة (RX): <strong className="text-slate-600">{formatBitrate(bw.host_rx_bps)}</strong>
              </p>
            )}
            {(bw.host_tx_bps > 0) && (
              <p>
                إرسال الشبكة (TX): <strong className="text-slate-600">{formatBitrate(bw.host_tx_bps)}</strong>
                {' '}— إجمالي الخروج من السيرفر
              </p>
            )}
          </div>
        </div>
      )}

      {(data?.online_users_list?.length > 0) && (
        <div className="card mb-6">
          <h2 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
            <Wifi className="w-5 h-5 text-emerald-600" /> المشاهدون المتصلون الآن
          </h2>
          <div className="flex flex-wrap gap-2">
            {data.online_users_list.map((u) => (
              <span
                key={`${u.username}-${u.last_seen}`}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full text-sm"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-medium text-slate-800">{u.username}</span>
                <span className="text-xs text-slate-400">مشاهد</span>
                {u.ip && <span className="text-xs font-mono text-slate-400">{u.ip}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card lg:col-span-2">
          <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-600" /> معلومات الجهاز
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <DetailRow label="اسم الجهاز" value={sys.hostname} />
            <DetailRow label="نظام التشغيل" value={`${platformLabel(sys.platform)} ${sys.os_release || ''}`} />
            <DetailRow label="المعمارية" value={sys.arch} />
            <DetailRow label="إصدار Node.js" value={sys.node_version} />
            <DetailRow label="المعالج" value={sys.cpu?.model} />
            <DetailRow label="عدد الأنوية" value={sys.cpu?.cores} />
            <DetailRow label="مدة تشغيل النظام" value={formatUptime(sys.uptime)} />
            <DetailRow label="مدة تشغيل التطبيق" value={formatUptime(sys.app_uptime)} />
            {bw.host_rx_bps > 0 && (
              <DetailRow label="استقبال الشبكة (RX)" value={formatBitrate(bw.host_rx_bps)} />
            )}
            {bw.host_tx_bps > 0 && (
              <DetailRow label="إرسال الشبكة (TX)" value={formatBitrate(bw.host_tx_bps)} />
            )}
            {bw.total_pull_bps > 0 && (
              <DetailRow label="سحب القنوات (داخل)" value={formatBitrate(bw.total_pull_bps)} />
            )}
            {bw.total_egress_bps > 0 && (
              <DetailRow label="بث خارج (للمشاهدين)" value={formatBitrate(bw.total_egress_bps)} />
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-600" /> Load Average
          </h2>
          <div className="space-y-3">
            {['1 د', '5 د', '15 د'].map((label, i) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-slate-500">{label}</span>
                <span className="font-bold text-slate-800">{sys.cpu?.load_average?.[i] ?? '-'}</span>
              </div>
            ))}
            <p className="text-xs text-slate-400 pt-2">
              PID: {sys.process?.pid || '-'} | Heap: {formatBytes(sys.process?.heap_used_bytes)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card">
          <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-600" /> المعالج (CPU)
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">الاستخدام الكلي</span>
              <span className="font-bold text-slate-800">{sys.cpu?.usage_percent ?? 0}%</span>
            </div>
            <ProgressBar value={sys.cpu?.usage_percent} color="bg-blue-500" />
            {sys.cpu?.per_core?.length > 0 && (
              <div className="pt-2 space-y-2">
                <p className="text-xs text-slate-400">استخدام كل نواة:</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {sys.cpu.per_core.map((pct, i) => (
                    <div key={i} className="text-center p-2 bg-slate-50 rounded border border-slate-100">
                      <p className="text-xs text-slate-400">#{i + 1}</p>
                      <p className="text-sm font-bold text-slate-700">{pct}%</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-emerald-600" /> الذاكرة (RAM)
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">الاستخدام</span>
              <span className="font-bold text-slate-800">{sys.memory?.usage_percent ?? 0}%</span>
            </div>
            <ProgressBar value={sys.memory?.usage_percent} color="bg-emerald-500" />
            <div className="text-xs text-slate-400 space-y-1">
              <p>المستخدم: {formatBytes(sys.memory?.used_bytes)}</p>
              <p>المتاح: {formatBytes(sys.memory?.free_bytes)}</p>
              <p>الإجمالي: {formatBytes(sys.memory?.total_bytes)}</p>
              <p className="pt-1 border-t border-slate-100">ذاكرة التطبيق (RSS): {formatBytes(sys.process?.rss_bytes)}</p>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Disc className="w-5 h-5 text-violet-600" /> القرص
          </h2>
          {primaryDisk ? (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">{primaryDisk.mount}</span>
                <span className="font-bold text-slate-800">{primaryDisk.usage_percent}%</span>
              </div>
              <ProgressBar value={primaryDisk.usage_percent} color="bg-violet-500" />
              <div className="text-xs text-slate-400 space-y-1">
                <p>المستخدم: {formatBytes(primaryDisk.used_bytes)}</p>
                <p>المتاح: {formatBytes(primaryDisk.free_bytes)}</p>
                <p>الإجمالي: {formatBytes(primaryDisk.total_bytes)}</p>
              </div>
              {sys.disk?.length > 1 && (
                <div className="pt-2 border-t border-slate-100 space-y-1">
                  {sys.disk.slice(1).map((d) => (
                    <p key={d.mount} className="text-xs text-slate-400">
                      {d.mount}: {formatBytes(d.used_bytes)} / {formatBytes(d.total_bytes)} ({d.usage_percent}%)
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">لا تتوفر بيانات القرص</p>
          )}
        </div>
      </div>

      {sys.network?.interfaces?.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Network className="w-5 h-5 text-cyan-600" /> الشبكة
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sys.network.interfaces.map((iface, i) => (
              <div
                key={`${iface.name}-${iface.address}-${i}`}
                className={`p-3 rounded-lg border ${
                  iface.is_primary
                    ? 'bg-cyan-50 border-cyan-200'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <p className="text-sm font-bold text-slate-700">{iface.label || iface.name}</p>
                <p className="text-xs text-slate-500 mt-1 font-mono">{iface.address}</p>
                <p className="text-xs text-slate-400">
                  {iface.family}{iface.mac ? ` · ${iface.mac}` : ''}
                  {iface.is_primary ? ' · IP البث' : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Monitor className="w-5 h-5 text-slate-600" /> حالة القنوات
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {Object.entries(channels).map(([status, count]) => (
            <div key={status} className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-2xl font-bold text-slate-800">{count}</p>
              <p className="text-xs text-slate-500 mt-1">{statusLabels[status] || status}</p>
            </div>
          ))}
        </div>
        <Link to="/channels" className="btn btn-primary btn-sm">
          <ArrowLeft className="w-4 h-4" /> إدارة القنوات
        </Link>
      </div>
    </div>
  );
}
