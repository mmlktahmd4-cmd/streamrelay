import { useEffect, useState } from 'react';
import { getSiteConfig, saveSiteConfig, refreshNetwork } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Globe, ExternalLink, RefreshCw, Lock, Copy, Check } from 'lucide-react';

export default function DomainDns() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [site, setSite] = useState(null);
  const [form, setForm] = useState({ public_domain: '', use_https: false });
  const [copied, setCopied] = useState(false);

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

  const sslDomain = (form.public_domain || 'example.com').trim();
  const sslCommand = `cd /opt/streamrelay && sudo bash scripts/setup-ssl.sh ${sslDomain}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sslCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  if (loading) return <LoadingSpinner className="py-24" />;

  const previewBase = site?.active_base_url || '';
  const previewViewer = site?.viewer_url || '';
  const previewAdmin = site?.admin_url || '';
  const httpsActive = !!site?.use_https;

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
          فعّله فقط بعد تركيب شهادة SSL (انظر القسم التالي). بدون شهادة، اترك الخيار فارغاً وستعمل الروابط عبر <span className="font-mono">http</span> مباشرة.
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

      <div className="card mb-6">
        <h2 className="font-bold text-slate-800 mb-1 flex items-center gap-2">
          <Lock className={`w-5 h-5 ${httpsActive ? 'text-emerald-600' : 'text-slate-400'}`} />
          تأمين الدومين (HTTPS / شهادة SSL مجانية)
        </h2>
        {httpsActive ? (
          <p className="text-sm text-emerald-700 mt-2">
            HTTPS مفعّل في الروابط ✓ — تأكد أن الشهادة مركّبة على السيرفر إن لم تكن قد ركّبتها.
          </p>
        ) : (
          <p className="text-sm text-slate-600 mt-2">
            الدومين يعمل الآن عبر <span className="font-mono">http</span> بدون أي إعداد إضافي. لتفعيل القفل الآمن
            <span className="font-mono"> https</span> بشهادة مجانية تلقائياً، نفّذ هذا الأمر <strong>مرة واحدة</strong> على السيرفر:
          </p>
        )}

        <div className="mt-3 flex items-stretch gap-2">
          <code className="flex-1 bg-slate-900 text-emerald-300 rounded-lg px-3 py-2.5 text-xs font-mono break-all" dir="ltr">
            {sslCommand}
          </code>
          <button type="button" onClick={handleCopy} className="btn btn-secondary shrink-0" title="نسخ الأمر">
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            {copied ? 'تم النسخ' : 'نسخ'}
          </button>
        </div>

        <ul className="text-xs text-slate-500 mt-3 leading-relaxed space-y-1 list-disc list-inside">
          <li>يحصل على شهادة Let&apos;s Encrypt مجانية، يفتح المنفذ 443، ويفعّل HTTPS في الروابط تلقائياً.</li>
          <li>يضبط التجديد التلقائي للشهادة — لا حاجة لأي صيانة لاحقاً.</li>
          <li>الشرط: سجل DNS (A) للدومين يشير إلى IP السيرفر، والمنفذ 443 مفتوح في جدار مزوّد الـ VPS.</li>
        </ul>
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
