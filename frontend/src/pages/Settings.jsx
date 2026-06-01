import { useEffect, useState } from 'react';
import { getBrandingSettings, saveBrandingSettings } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Settings as SettingsIcon, RotateCcw, LayoutGrid, Image, List, Rows3, Check } from 'lucide-react';

const DEFAULTS = {
  app_title: 'StreamRelay TV',
  app_tagline: 'بث داخلي آمن',
  live_watch_notice: 'أنت تشاهد عبر البث الداخلي على شبكة السيرفر',
  vod_watch_notice: 'تشغيل فيلم من السيرفر المحلي',
  viewer_layout: 'grid',
};

const LAYOUT_OPTIONS = [
  { id: 'grid', label: 'شبكة بطاقات', desc: 'بطاقات عريضة 16:9 مقسّمة لأقسام — الافتراضي', icon: LayoutGrid },
  { id: 'posters', label: 'بوسترات سينمائية', desc: 'بطاقات عمودية 2:3 بكثافة أعلى — مثالي للأفلام', icon: Image },
  { id: 'list', label: 'قائمة مدمجة', desc: 'صفوف أفقية مع شعار واسم وزر تشغيل — مناسب لقوائم IPTV الطويلة', icon: List },
  { id: 'rows', label: 'صفوف أفقية', desc: 'كل قسم صف قابل للتمرير الأفقي — نمط Netflix/Shahid', icon: Rows3 },
];

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(DEFAULTS);

  const loadSettings = async () => {
    try {
      const { data } = await getBrandingSettings();
      setForm({ ...DEFAULTS, ...data });
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { loadSettings(); }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('جاري الحفظ...');
    try {
      const { data } = await saveBrandingSettings(form);
      setForm({ ...DEFAULTS, ...data });
      setMessage('تم حفظ الإعدادات — ستظهر في بوابة المشاهدة');
    } catch (err) {
      setMessage(err.response?.data?.error || 'تعذّر حفظ الإعدادات');
    }
    setSaving(false);
  };

  const handleReset = () => {
    setForm(DEFAULTS);
    setMessage('تمت استعادة النصوص الافتراضية — اضغط «حفظ» لتطبيقها');
  };

  if (loading) return <LoadingSpinner className="py-24" />;

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="page-title flex items-center gap-2">
          <SettingsIcon className="w-7 h-7 text-slate-600" />
          الإعدادات
        </h1>
        <p className="page-subtitle mt-1">
          تخصيص النصوص الظاهرة في بوابة المشاهدة للعملاء
        </p>
      </div>

      <form onSubmit={handleSave} className="card space-y-5">
        <h2 className="font-bold text-slate-800">نموذج عرض القنوات</h2>
        <p className="text-xs text-slate-400 -mt-3">اختر شكل عرض القنوات في بوابة المشاهدة — يُطبّق فوراً بعد الحفظ.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {LAYOUT_OPTIONS.map(({ id, label, desc, icon: Icon }) => {
            const active = form.viewer_layout === id;
            return (
              <button
                type="button"
                key={id}
                onClick={() => setForm((prev) => ({ ...prev, viewer_layout: id }))}
                className={`relative text-right rounded-xl border p-4 transition-all ${
                  active
                    ? 'border-teal-500 bg-teal-50 ring-1 ring-teal-500'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                {active && (
                  <span className="absolute top-3 left-3 w-5 h-5 rounded-full bg-teal-600 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </span>
                )}
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${active ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <p className="font-bold text-slate-800 text-sm">{label}</p>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{desc}</p>
              </button>
            );
          })}
        </div>

        <div className="border-t border-slate-100 pt-5">
          <h2 className="font-bold text-slate-800">نصوص بوابة المشاهدة</h2>
        </div>

        <div>
          <label className="label">اسم التطبيق (العنوان الرئيسي)</label>
          <input
            className="input"
            value={form.app_title}
            onChange={(e) => setForm((prev) => ({ ...prev, app_title: e.target.value }))}
            placeholder={DEFAULTS.app_title}
            maxLength={80}
          />
          <p className="text-xs text-slate-400 mt-1">يظهر في الهيدر وصفحة الدخول — مثل: StreamRelay TV</p>
        </div>

        <div>
          <label className="label">الشعار الفرعي</label>
          <input
            className="input"
            value={form.app_tagline}
            onChange={(e) => setForm((prev) => ({ ...prev, app_tagline: e.target.value }))}
            placeholder={DEFAULTS.app_tagline}
            maxLength={120}
          />
          <p className="text-xs text-slate-400 mt-1">سطر صغير تحت الاسم — مثل: بث داخلي آمن</p>
        </div>

        <div>
          <label className="label">رسالة أثناء مشاهدة القنوات</label>
          <textarea
            className="input min-h-[80px]"
            value={form.live_watch_notice}
            onChange={(e) => setForm((prev) => ({ ...prev, live_watch_notice: e.target.value }))}
            placeholder={DEFAULTS.live_watch_notice}
            maxLength={200}
          />
        </div>

        <div>
          <label className="label">رسالة أثناء تشغيل الأفلام</label>
          <textarea
            className="input min-h-[80px]"
            value={form.vod_watch_notice}
            onChange={(e) => setForm((prev) => ({ ...prev, vod_watch_notice: e.target.value }))}
            placeholder={DEFAULTS.vod_watch_notice}
            maxLength={200}
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleReset}>
            <RotateCcw className="w-4 h-4" /> استعادة الافتراضي
          </button>
        </div>

        {message && (
          <p className={`text-sm ${message.includes('تعذّر') ? 'text-red-600' : 'text-emerald-700'}`}>
            {message}
          </p>
        )}
      </form>

      <div className="card mt-6 bg-slate-50">
        <h3 className="text-sm font-bold text-slate-700 mb-3">معاينة</h3>
        <div className="rounded-lg bg-slate-900 p-4 text-center">
          <p className="font-bold text-white text-lg">{form.app_title || DEFAULTS.app_title}</p>
          <p className="text-teal-400/80 text-xs mt-1">{form.app_tagline || DEFAULTS.app_tagline}</p>
        </div>
        <p className="text-xs text-slate-500 mt-3 text-center">
          {form.live_watch_notice || DEFAULTS.live_watch_notice}
        </p>
      </div>
    </div>
  );
}
