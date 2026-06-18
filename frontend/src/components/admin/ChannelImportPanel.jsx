import { useMemo, useRef, useState } from 'react';
import {
  importM3U,
  previewM3UFromUrl,
  importM3USelected,
  getCategories,
  proxiedImageUrl,
} from '../../api/client';
import {
  Upload,
  FileText,
  X,
  Link2,
  Search,
  CheckSquare,
  Square,
  Tv2,
  Loader2,
} from 'lucide-react';

function ImportResult({ result }) {
  if (!result) return null;
  return (
    <div className="admin-alert admin-alert-success mb-4 text-sm">
      تم استيراد <strong>{result.imported?.length || 0}</strong> قناة من أصل {result.total_parsed || 0}
      {result.skipped?.length > 0 && ` — تخطّي ${result.skipped.length} مكررة`}
      {result.errors?.length > 0 && ` — ${result.errors.length} أخطاء`}
    </div>
  );
}

export default function ChannelImportPanel({ onDone }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('url');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [onDemand, setOnDemand] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [groupFilter, setGroupFilter] = useState('');
  const [search, setSearch] = useState('');
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

  const filteredChannels = useMemo(() => {
    if (!preview?.channels) return [];
    const q = search.trim().toLowerCase();
    return preview.channels.filter((ch) => {
      if (groupFilter && ch.group !== groupFilter) return false;
      if (!q) return true;
      return ch.name.toLowerCase().includes(q)
        || (ch.group || '').toLowerCase().includes(q);
    });
  }, [preview, groupFilter, search]);

  const handlePreviewUrl = async () => {
    const url = playlistUrl.trim();
    if (!url) {
      alert('أدخل رابط قائمة القنوات');
      return;
    }
    setPreviewLoading(true);
    setResult(null);
    setPreview(null);
    setSelectedIds(new Set());
    try {
      const { data } = await previewM3UFromUrl(url);
      setPreview(data);
      setSelectedIds(new Set(data.channels.map((ch) => ch.id)));
    } catch (err) {
      alert(err.response?.data?.error || 'فشل تحميل القائمة من الرابط');
    } finally {
      setPreviewLoading(false);
    }
  };

  const toggleChannel = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = (checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredChannels.forEach((ch) => {
        if (checked) next.add(ch.id);
        else next.delete(ch.id);
      });
      return next;
    });
  };

  const allVisibleSelected = filteredChannels.length > 0
    && filteredChannels.every((ch) => selectedIds.has(ch.id));

  const handleImportSelected = async () => {
    if (!preview?.channels?.length) return;
    const picked = preview.channels.filter((ch) => selectedIds.has(ch.id));
    if (!picked.length) {
      alert('حدد قناة واحدة على الأقل');
      return;
    }
    if (!confirm(`رفع ${picked.length} قناة إلى اللوحة؟`)) return;

    setLoading(true);
    setResult(null);
    try {
      const { data } = await importM3USelected(
        picked.map(({ name, url, logo_url, group, epg_id }) => ({
          name,
          url,
          logo_url,
          group,
          epg_id,
        })),
        {
          category_id: categoryId || undefined,
          is_public: isPublic,
          on_demand: onDemand,
        }
      );
      setResult(data);
      setPreview(null);
      setSelectedIds(new Set());
      onDone?.();
    } catch (err) {
      alert(err.response?.data?.error || 'فشل الاستيراد');
    } finally {
      setLoading(false);
    }
  };

  const handleImportFile = async () => {
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
        on_demand: onDemand,
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
    setPlaylistUrl('');
    setPreview(null);
    setSelectedIds(new Set());
    setGroupFilter('');
    setSearch('');
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const closePanel = () => {
    setOpen(false);
    reset();
  };

  if (!open) {
    return (
      <button type="button" onClick={handleOpen} className="btn btn-secondary whitespace-nowrap">
        <Upload className="w-4 h-4" /> استيراد قنوات
      </button>
    );
  }

  return (
    <div className="card mb-6 border-blue-200 bg-blue-50/30">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" /> استيراد قنوات
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            من رابط Xtream/M3U مباشر أو ملف — مع معاينة واختيار القنوات قبل الرفع
          </p>
        </div>
        <button type="button" onClick={closePanel} className="btn-icon">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => setMode('url')}
          className={`btn text-sm ${mode === 'url' ? 'btn-primary' : 'btn-secondary'}`}
        >
          <Link2 className="w-4 h-4" /> من رابط
        </button>
        <button
          type="button"
          onClick={() => setMode('file')}
          className={`btn text-sm ${mode === 'file' ? 'btn-primary' : 'btn-secondary'}`}
        >
          <FileText className="w-4 h-4" /> ملف / لصق
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="label">التصنيف (اختياري)</label>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">بدون تصنيف</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-2 self-end pb-1">
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="rounded" />
            قنوات عامة (متاحة للمشاهدين)
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={onDemand} onChange={(e) => setOnDemand(e.target.checked)} className="rounded mt-0.5" />
            <span>
              <span className="font-medium text-slate-800">On Demand — تشغيل عند الطلب</span>
              <span className="block text-xs text-slate-500">لا تشتغل إلا عند فتح المشاهد للقناة</span>
            </span>
          </label>
        </div>
      </div>

      {mode === 'url' && (
        <>
          <div className="mb-4">
            <label className="label">رابط قائمة القنوات (M3U)</label>
            <input
              type="url"
              dir="ltr"
              className="input font-mono text-xs"
              placeholder="http://host:port/get.php?username=...&password=...&type=m3u&output=mpegts"
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">
              الصق رابط Xtream أو أي رابط M3U مباشر — يدعم ملفات كبيرة حتى 100MB
            </p>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              type="button"
              onClick={handlePreviewUrl}
              className="btn btn-primary"
              disabled={previewLoading || !playlistUrl.trim()}
            >
              {previewLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" /> تحميل ومعاينة القنوات
                </>
              )}
            </button>
            {preview && (
              <button type="button" onClick={() => { setPreview(null); setSelectedIds(new Set()); }} className="btn btn-secondary">
                مسح المعاينة
              </button>
            )}
          </div>

          {preview && (
            <div className="mb-4 border border-slate-200 rounded-xl bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {preview.total} قناة — محدّد: {selectedIds.size}
                  </p>
                  <p className="text-xs text-slate-500 font-mono truncate max-w-xl" dir="ltr">{preview.url}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => selectVisible(!allVisibleSelected)}
                    className="btn btn-secondary text-xs py-1.5"
                  >
                    {allVisibleSelected ? <Square className="w-3.5 h-3.5" /> : <CheckSquare className="w-3.5 h-3.5" />}
                    {allVisibleSelected ? 'إلغاء المعروض' : 'تحديد المعروض'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set(preview.channels.map((ch) => ch.id)))}
                    className="btn btn-secondary text-xs py-1.5"
                  >
                    تحديد الكل
                  </button>
                </div>
              </div>

              <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-3">
                <div className="flex-1 min-w-[180px]">
                  <input
                    className="input text-sm"
                    placeholder="بحث بالاسم..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {preview.groups?.length > 0 && (
                  <select
                    className="input text-sm min-w-[160px]"
                    value={groupFilter}
                    onChange={(e) => setGroupFilter(e.target.value)}
                  >
                    <option value="">كل المجموعات</option>
                    {preview.groups.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                {filteredChannels.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">لا توجد قنوات مطابقة</p>
                ) : (
                  filteredChannels.map((ch) => {
                    const checked = selectedIds.has(ch.id);
                    return (
                      <label
                        key={ch.id}
                        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 ${checked ? 'bg-blue-50/40' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleChannel(ch.id)}
                          className="rounded shrink-0"
                        />
                        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                          {ch.logo_url ? (
                            <img
                              src={proxiedImageUrl(ch.logo_url)}
                              alt=""
                              className="w-full h-full object-contain"
                              loading="lazy"
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                          ) : (
                            <Tv2 className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800 truncate">{ch.name}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {ch.group || 'بدون مجموعة'}
                            {ch.source_type ? ` · ${ch.source_type}` : ''}
                          </p>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>

              <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
                <button
                  type="button"
                  onClick={handleImportSelected}
                  className="btn btn-primary"
                  disabled={loading || selectedIds.size === 0}
                >
                  {loading ? 'جاري الرفع...' : `رفع ${selectedIds.size} قناة محددة`}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'file' && (
        <>
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
          </div>

          <div className="mb-4">
            <label className="label">أو الصق محتوى M3U مباشرة</label>
            <textarea
              className="input font-mono text-xs h-32"
              dir="ltr"
              placeholder="#EXTM3U&#10;#EXTINF:-1 tvg-logo=&quot;...&quot;,Channel Name&#10;http://..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>

          <div className="flex gap-3 mb-4">
            <button type="button" onClick={handleImportFile} className="btn btn-primary" disabled={loading}>
              {loading ? 'جاري الاستيراد...' : 'استيراد كل القنوات'}
            </button>
            <button type="button" onClick={reset} className="btn btn-secondary">مسح</button>
          </div>
        </>
      )}

      <ImportResult result={result} />
    </div>
  );
}
