import { useState, useRef } from 'react';
import { importM3U, getCategories } from '../../api/client';
import { Upload, FileText, X } from 'lucide-react';

export default function ChannelImportPanel({ onDone }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const loadCategories = () => {
    if (categories.length) return;
    getCategories().then(({ data }) => setCategories(data)).catch(() => {});
  };

  const handleOpen = () => {
    setOpen(true);
    setResult(null);
    loadCategories();
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setContent(ev.target.result);
    reader.readAsText(file, 'UTF-8');
  };

  const handleImport = async () => {
    if (!content.trim()) {
      alert('اختر ملف M3U أو الصق المحتوى');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data } = await importM3U(content, {
        category_id: categoryId || undefined,
        is_public: isPublic,
      });
      setResult(data);
      onDone?.();
    } catch (err) {
      alert(err.response?.data?.error || 'فشل الاستيراد');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setContent('');
    setFileName('');
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  if (!open) {
    return (
      <button type="button" onClick={handleOpen} className="btn btn-secondary whitespace-nowrap">
        <Upload className="w-4 h-4" /> استيراد ملف قنوات
      </button>
    );
  }

  return (
    <div className="card mb-6 border-blue-200 bg-blue-50/30">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" /> استيراد ملف M3U
          </h3>
          <p className="text-xs text-slate-500 mt-1">يدعم ملفات Xtream UI و M3U العادية — .m3u / .txt</p>
        </div>
        <button type="button" onClick={() => { setOpen(false); reset(); }} className="btn-icon">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="label">اختر ملف القنوات</label>
          <input
            ref={fileRef}
            type="file"
            accept=".m3u,.m3u8,.txt,text/plain"
            onChange={handleFile}
            className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-semibold hover:file:bg-blue-700"
          />
          {fileName && <p className="text-xs text-emerald-600 mt-1">✓ {fileName}</p>}
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">التصنيف (اختياري)</label>
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">بدون تصنيف</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="rounded" />
            قنوات عامة (متاحة للمشاهدين)
          </label>
        </div>
      </div>

      <div className="mb-4">
        <label className="label">أو الصق محتوى M3U مباشرة</label>
        <textarea
          className="input font-mono text-xs h-32"
          dir="ltr"
          placeholder="#EXTM3U&#10;#EXTINF:-1,Channel Name&#10;http://..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>

      {result && (
        <div className="admin-alert admin-alert-success mb-4 text-sm">
          تم استيراد <strong>{result.imported?.length || 0}</strong> قناة من أصل {result.total_parsed || 0}
          {result.skipped?.length > 0 && ` — تخطّي ${result.skipped.length} مكررة`}
          {result.errors?.length > 0 && ` — ${result.errors.length} أخطاء`}
        </div>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={handleImport} className="btn btn-primary" disabled={loading}>
          {loading ? 'جاري الاستيراد...' : 'استيراد القنوات'}
        </button>
        <button type="button" onClick={reset} className="btn btn-secondary">مسح</button>
      </div>
    </div>
  );
}
