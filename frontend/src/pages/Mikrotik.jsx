import { useEffect, useState } from 'react';
import {
  getMikrotikConfig, saveMikrotikConfig, getMikrotikScripts,
} from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Router, Copy, Check, RefreshCw, ExternalLink } from 'lucide-react';

function CopyButton({ text, label = 'نسخ السكربت', disabled }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (disabled || !text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('لم ينجح النسخ. حدّد النص وانسخه يدوياً (Ctrl+C).');
    }
  };

  return (
    <button type="button" onClick={handleCopy} className="btn btn-primary" disabled={disabled}>
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      {copied ? 'تم النسخ' : label}
    </button>
  );
}

function previewSubnet(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  if (parts.some((p) => Number.isNaN(parseInt(p, 10)))) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

export default function Mikrotik() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState(null);
  const [scripts, setScripts] = useState(null);
  const [serverIp, setServerIp] = useState('');
  const [showRemove, setShowRemove] = useState(false);

  const loadAll = async () => {
    try {
      const [configRes, scriptsRes] = await Promise.all([
        getMikrotikConfig(),
        getMikrotikScripts(),
      ]);
      setConfig(configRes.data);
      setServerIp(configRes.data.server_ip || '');
      setScripts(scriptsRes.data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await saveMikrotikConfig({ server_ip: serverIp.trim() });
      setConfig(data);
      setServerIp(data.server_ip);
      const scriptsRes = await getMikrotikScripts();
      setScripts(scriptsRes.data);
    } catch (err) {
      alert(err.response?.data?.error || 'أدخل عنوان IP صحيح (مثل 30.30.30.1)');
    }
    setSaving(false);
  };

  if (loading) return <LoadingSpinner className="py-24" />;

  const guide = scripts?.guide;
  const mainScript = scripts?.scripts?.main || '';
  const removeScript = scripts?.scripts?.remove || '';
  const viewerUrl = scripts?.links?.viewer_url || '';
  const savedSubnet = config?.client_subnet || previewSubnet(serverIp);
  const hasSavedIp = !!config?.server_ip;

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="page-title flex items-center gap-2">
          <Router className="w-7 h-7 text-blue-600" />
          ربط MikroTik
        </h1>
        <p className="page-subtitle mt-1">
          ثبّت IP على جهاز البث وأعطِ العملاء نفس الشبكة للمشاهدة
        </p>
      </div>

      <div className="card mb-6">
        <h2 className="font-bold text-slate-800 mb-3">كيف يشتغل؟</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          جهاز البث لازم يكون عليه <strong>IP ثابت</strong> يطابق هذا الرقم — ثبّته من صفحة
          <strong> «IP السيرفر» </strong> في اللوحة، أو احجزه في الميكروتك (DHCP Static Lease).
          العملاء على نفس شبكة الميكروتك يفتحون رابط المشاهدة، والسكربت أدناه يفتح لهم الوصول لجهاز البث.
        </p>
      </div>

      <div className="card mb-6">
        <h2 className="font-bold text-slate-800 mb-4">خطوات الربط</h2>
        <ol className="space-y-3">
          {(guide?.steps || []).map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-700">
              <span className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold shrink-0 text-xs">
                {i + 1}
              </span>
              <span className="pt-1 leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="card mb-6">
        <h2 className="font-bold text-slate-800 mb-2">IP جهاز البث (ثابت)</h2>
        <p className="text-sm text-slate-500 mb-4">
          نفس الـ IP اللي ثبّته على كرت الشبكة في جهاز البث. مثال: <span className="font-mono">30.30.30.1</span>
        </p>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            className="input font-mono flex-1 text-lg"
            value={serverIp}
            onChange={(e) => setServerIp(e.target.value)}
            placeholder="30.30.30.1"
          />
          <button type="button" onClick={handleSave} className="btn btn-primary" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
        {previewSubnet(serverIp) && (
          <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
            شبكة العملاء في السكربت: <span className="font-mono font-bold">{previewSubnet(serverIp)}</span>
            <span className="text-slate-400 block text-xs mt-1">تُحسب تلقائياً — كل الأجهزة على هذه الشبكة تقدر توصل لجهاز البث</span>
          </p>
        )}
        {config?.detected?.detected_ip && !hasSavedIp && (
          <p className="text-xs text-slate-400 mt-2">
            IP المكتشف حالياً على الجهاز: {config.detected.detected_ip} — إذا تستخدم IP ثابت مختلف، اكتبه فوق.
          </p>
        )}
      </div>

      {hasSavedIp && (
        <div className="card mb-6 p-4 bg-blue-50 border border-blue-100">
          <p className="text-sm text-slate-700 mb-1"><strong>جهاز البث:</strong> <span className="font-mono">{config.server_ip}</span></p>
          <p className="text-sm text-slate-700 mb-1"><strong>شبكة العملاء:</strong> <span className="font-mono">{savedSubnet}</span></p>
          <p className="text-sm text-slate-700">
            <strong>رابط العملاء:</strong>{' '}
            <a href={viewerUrl} target="_blank" rel="noreferrer" className="font-mono text-blue-600 hover:underline inline-flex items-center gap-1">
              {viewerUrl} <ExternalLink className="w-3 h-3" />
            </a>
          </p>
          {config?.active_urls?.hls_base && (
            <p className="text-xs text-green-800 mt-3 pt-3 border-t border-blue-200">
              روابط البث الداخلي للقنوات تُحدَّث تلقائياً على:{' '}
              <span className="font-mono">{config.active_urls.hls_base}</span>
            </p>
          )}
        </div>
      )}

      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-bold text-slate-800">السكربت الجاهز</h2>
            <p className="text-sm text-slate-500 mt-1">
              {hasSavedIp ? 'انسخه والصقه في Terminal الميكروtik' : 'احفظ IP جهاز البث أولاً'}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={loadAll} className="btn btn-secondary btn-sm">
              <RefreshCw className="w-4 h-4" /> تحديث
            </button>
            <CopyButton text={mainScript} disabled={!hasSavedIp} />
          </div>
        </div>
        <pre className="mikrotik-script text-xs leading-relaxed overflow-x-auto max-h-64">{mainScript}</pre>
      </div>

      <div className="card mb-6">
        <h2 className="font-bold text-slate-800 mb-3">ملاحظات</h2>
        <ul className="space-y-2 text-sm text-slate-600">
          {(guide?.notes || []).map((note, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-blue-500">•</span>
              <span>{note}</span>
            </li>
          ))}
          <li className="flex gap-2">
            <span className="text-blue-500">•</span>
            <span>ثبّت IP جهاز البث من صفحة «IP السيرفر» في اللوحة (يدعم ثابت / DHCP).</span>
          </li>
        </ul>
      </div>

      <div className="card">
        <button
          type="button"
          onClick={() => setShowRemove(!showRemove)}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          {showRemove ? 'إخفاء' : 'عرض'} سكربت حذف الإعداد
        </button>
        {showRemove && (
          <div className="mt-4">
            <CopyButton text={removeScript} label="نسخ سكربت الحذف" />
            <pre className="mikrotik-script text-xs mt-3 max-h-32">{removeScript}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
