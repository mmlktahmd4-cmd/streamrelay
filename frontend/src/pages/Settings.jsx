import { useEffect, useState } from 'react';
import { getBrandingSettings, saveBrandingSettings } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Settings as SettingsIcon, RotateCcw } from 'lucide-react';

const DEFAULTS = {
  app_title: 'StreamRelay TV',
  app_tagline: 'بث داخلي آمن',
  live_watch_notice: 'أنت تشاهد عبر البث الداخلي على شبكة السيرفر',
  vod_watch_notice: 'تشغيل فيلم من السيرفر المحلي',
};

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
        <h2 className="font-bold text-slate-800">نصوص بوابة المشاهدة</h2>

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
