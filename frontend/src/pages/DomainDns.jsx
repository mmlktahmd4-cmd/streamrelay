import { useEffect, useState } from 'react';
import { getSiteConfig, saveSiteConfig, refreshNetwork } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Globe, ExternalLink, RefreshCw } from 'lucide-react';

export default function DomainDns() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [site, setSite] = useState(null);
  const [form, setForm] = useState({ public_domain: '', use_https: false });

  const loadSite = async () => {
    try {
      const { data } = await getSiteConfig();
      setSite(data);
      setForm({
        public_domain: data.public_domain || '',
        use_https: !!data.use_https,
      });
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { loadSite(); }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('جاري الحفظ...');
    try {
      const { data: saved } = await saveSiteConfig(form);
      setSite(saved);
      setForm({
        public_domain: saved.public_domain || '',
        use_https: !!saved.use_https,
      });
      setMessage('تم حفظ الدومين وتحديث روابط القنوات');
    } catch (err) {
      setMessage(err.response?.data?.error || 'تعذّر حفظ الدومين');
    }
    setSaving(false);
  };

  const handleRefreshNetwork = async () => {
    setMessage('جاري تحديث IP...');
    try {
      const { data: net } = await refreshNetwork();
      await loadSite();
      setMessage(net?.message || 'تم تحديث IP الشبكة');
    } catch {
      setMessage('تعذّر تحديث IP');
    }
  };

  if (loading) return <LoadingSpinner className="py-24" />;

  const previewBase = site?.active_base_url || '';
  const previewViewer = site?.viewer_url || '';
  const previewAdmin = site?.admin_url || '';

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="page-title flex items-center gap-2">
          <Globe className="w-7 h-7 text-cyan-600" />
          ربط دومين (DNS)
        </h1>
        <p className="page-subtitle mt-1">
          أخفِ IP السيرفر عن العملاء — الروابط العامة تستخدم اسم الدومين
        </p>
      </div>

      <div className="card mb-6">
        <h2 className="font-bold text-slate-800 mb-3">كيف يشتغل؟</h2>
        <ol className="text-sm text-slate-600 leading-relaxed space-y-2 list-decimal list-inside">
          <li>سجّل دوميناً (مثل <span className="font-mono">tv.example.com</span>).</li>
          <li>في لوحة DNS، أنشئ سجل <strong>A</strong> يشير إلى IP السيرفر.</li>
          <li>اكتب الدومين هنا واحفظ — روابط القنوات والمشاهدة تتحدّث تلقائياً.</li>
        </ol>
        {site?.server_ip && (
          <p className="text-sm text-slate-600 mt-4 pt-4 border-t border-slate-100">
            <strong>IP السيرفر الحالي:</strong>{' '}
            <span className="font-mono">{site.server_ip}</span>
            {' '}— وجّه سجل A إلى هذا العنوان.
          </p>
        )}
      </div>

      <div className="card mb-6 space-y-4">
        <h2 className="font-bold text-slate-800">إعداد الدومين</h2>

        <div>
          <label className="label">اسم الدومين</label>
          <input
            type="text"
            dir="ltr"
            className="input font-mono"
            placeholder="tv.example.com"
            value={form.public_domain}
            onChange={(e) => setForm((prev) => ({ ...prev, public_domain: e.target.value }))}
          />
          <p className="text-xs text-slate-400 mt-1">اتركه فارغاً لاستخدام IP مباشرة.</p>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.use_https}
            onChange={(e) => setForm((prev) => ({ ...prev, use_https: e.target.checked }))}
          />
          استخدام HTTPS في الروابط العامة
        </label>
        <p className="text-xs text-slate-400 -mt-2">
          يتطلب شهادة SSL على nginx — فعّله فقط بعد إعداد HTTPS على السيرفر.
        </p>

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="button" onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? 'جاري الحفظ...' : 'حفظ الدومين'}
          </button>
          <button type="button" onClick={handleRefreshNetwork} className="btn btn-secondary">
            <RefreshCw className="w-4 h-4" /> تحديث IP
          </button>
        </div>

        {message && (
          <p className={`text-sm ${message.includes('تعذّر') ? 'text-red-600' : 'text-emerald-700'}`}>
            {message}
          </p>
        )}
      </div>

      {(previewBase || previewViewer) && (
        <div className="card">
          <h2 className="font-bold text-slate-800 mb-3">الروابط النشطة</h2>
          <div className="text-sm text-slate-700 space-y-2">
            {previewBase && (
              <p>
                <strong>الرابط الأساسي:</strong>{' '}
                <span className="font-mono text-xs break-all">{previewBase}</span>
              </p>
            )}
            {previewViewer && (
              <p className="flex flex-wrap items-center gap-2">
                <strong>المشاهدة:</strong>
                <a href={previewViewer} target="_blank" rel="noreferrer" className="font-mono text-xs text-cyan-700 hover:underline break-all">
                  {previewViewer}
                </a>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </p>
            )}
            {previewAdmin && (
              <p>
                <strong>لوحة الإدارة:</strong>{' '}
                <span className="font-mono text-xs break-all">{previewAdmin}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
