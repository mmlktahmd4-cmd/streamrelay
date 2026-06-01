import { useEffect, useState } from 'react';
import { getAppInfo, getAppDownloadUrl } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Smartphone, Download, Copy, Check, AlertCircle } from 'lucide-react';

function formatSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export default function AppDownload() {
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [copied, setCopied] = useState('');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const host = typeof window !== 'undefined' ? window.location.host : '';
  const downloadUrl = `${origin}${getAppDownloadUrl()}`;
  const watchUrl = `${origin}/watch/login`;

  useEffect(() => {
    getAppInfo()
      .then(({ data }) => setInfo(data))
      .catch(() => setInfo({ available: false }))
      .finally(() => setLoading(false));
  }, []);

  const copy = (text, key) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  if (loading) return <LoadingSpinner className="min-h-[40vh]" />;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-teal-500/15 flex items-center justify-center">
          <Smartphone className="w-6 h-6 text-teal-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">تطبيق المشاهدة (أندرويد)</h1>
          <p className="text-sm text-slate-500">تطبيق يفتح بوابة المشاهدة مباشرةً دون متصفح.</p>
        </div>
      </div>

      {info?.available ? (
        <div className="bg-white rounded-2xl border border-[#dde3ea] p-6 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="font-semibold text-slate-800">StreamRelay.apk</p>
              <p className="text-sm text-slate-500">
                {formatSize(info.size)}
                {info.updated_at ? ` · حُدّث ${new Date(info.updated_at).toLocaleDateString('ar')}` : ''}
              </p>
            </div>
            <a
              href={getAppDownloadUrl()}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              تحميل APK
            </a>
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold">التطبيق غير متوفر على هذا السيرفر بعد.</p>
            <p className="mt-1">
              يُبنى الـ APK تلقائياً على GitHub، ثم يُنزّله السيرفر عند التحديث. يمكنك أيضاً تحميله مباشرةً من صفحة
              الإصدارات (Releases → app-latest) على مستودع المشروع.
            </p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[#dde3ea] p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-slate-800">خطوات الاستخدام</h2>
        <ol className="list-decimal pr-5 space-y-2 text-sm text-slate-600">
          <li>حمّل ملف <b>StreamRelay.apk</b> على هاتف الأندرويد وثبّته (فعّل «تثبيت من مصادر غير معروفة» إن طُلب).</li>
          <li>افتح التطبيق وأدخل عنوان السيرفر التالي عند أول تشغيل:</li>
        </ol>

        <div className="space-y-2">
          <FieldCopy label="عنوان السيرفر (يُدخل في التطبيق)" value={host} copied={copied === 'host'} onCopy={() => copy(host, 'host')} />
          <FieldCopy label="رابط تحميل التطبيق (شاركه مع المستخدمين)" value={downloadUrl} copied={copied === 'dl'} onCopy={() => copy(downloadUrl, 'dl')} />
          <FieldCopy label="رابط بوابة المشاهدة في المتصفح" value={watchUrl} copied={copied === 'watch'} onCopy={() => copy(watchUrl, 'watch')} />
        </div>

        <p className="text-xs text-slate-400">
          ملاحظة: إذا تغيّر IP السيرفر لاحقاً، يكفي أن يفتح المستخدم ⋮ → «تغيير عنوان السيرفر» داخل التطبيق ويُدخل العنوان الجديد.
        </p>
      </div>
    </div>
  );
}

function FieldCopy({ label, value, copied, onCopy }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700 ltr-text overflow-x-auto" dir="ltr">{value}</code>
        <button
          onClick={onCopy}
          className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
          title="نسخ"
        >
          {copied ? <Check className="w-4 h-4 text-teal-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
