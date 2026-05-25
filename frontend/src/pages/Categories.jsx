import { useEffect, useState, useRef } from 'react';
import {
  getCategoriesFull, getCategory, createCategory, updateCategory, deleteCategory,
  uploadMovie, deleteMovie,
} from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import {
  FolderPlus, Pencil, Trash2, Film, Radio, Upload, Plus, X, ChevronDown, ChevronUp,
} from 'lucide-react';

const sectionTypes = [
  { value: 'mixed', label: 'مختلط (قنوات + أفلام)' },
  { value: 'live', label: 'قنوات مباشرة فقط' },
  { value: 'movies', label: 'أفلام فقط' },
];

function formatBytes(bytes) {
  if (!bytes) return '-';
  const gb = bytes / 1073741824;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedData, setExpandedData] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', section_type: 'mixed', sort_order: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const fileRef = useRef(null);
  const [movieForm, setMovieForm] = useState({ name: '', description: '', is_public: true });

  const fetchCategories = async () => {
    try {
      const { data } = await getCategoriesFull();
      setCategories(data || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchCategories(); }, []);

  const loadExpanded = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedData(null);
      return;
    }
    setExpandedId(id);
    try {
      const { data } = await getCategory(id);
      setExpandedData(data);
    } catch {
      setExpandedData(null);
    }
  };

  const resetForm = () => {
    setForm({ name: '', description: '', section_type: 'mixed', sort_order: 0 });
    setEditId(null);
    setShowForm(false);
  };

  const handleSaveCategory = async (e) => {
    e.preventDefault();
    try {
      if (editId) {
        await updateCategory(editId, form);
      } else {
        await createCategory(form);
      }
      resetForm();
      fetchCategories();
    } catch (err) {
      alert(err.response?.data?.error || 'حدث خطأ');
    }
  };

  const handleEdit = (cat) => {
    setEditId(cat.id);
    setForm({
      name: cat.name,
      description: cat.description || '',
      section_type: cat.section_type || 'mixed',
      sort_order: cat.sort_order || 0,
    });
    setShowForm(true);
  };

  const handleDeleteCategory = async (id) => {
    if (!confirm('حذف هذا القسم؟ المحتوى سيُفك ربطه فقط.')) return;
    await deleteCategory(id);
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedData(null);
    }
    fetchCategories();
  };

  const handleUpload = async (categoryId, e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      alert('اختر ملف فيديو');
      return;
    }

    setUploading(true);
    setUploadProgress('جاري الرفع...');
    try {
      await uploadMovie(categoryId, file, {
        name: movieForm.name || file.name.replace(/\.[^.]+$/, ''),
        description: movieForm.description,
        is_public: movieForm.is_public,
        onProgress: (pct) => setUploadProgress(`جاري الرفع... ${pct}%`),
      });
      setMovieForm({ name: '', description: '', is_public: true });
      if (fileRef.current) fileRef.current.value = '';
      setUploadProgress('');
      fetchCategories();
      if (expandedId === categoryId) {
        const { data } = await getCategory(categoryId);
        setExpandedData(data);
      }
    } catch (err) {
      alert(err.response?.data?.error || 'فشل رفع الفيلم');
    }
    setUploading(false);
    setUploadProgress('');
  };

  const handleDeleteMovie = async (movieId) => {
    if (!confirm('حذف هذا الفيلم نهائياً؟')) return;
    await deleteMovie(movieId);
    fetchCategories();
    if (expandedId) {
      const { data } = await getCategory(expandedId);
      setExpandedData(data);
    }
  };

  if (loading) return <LoadingSpinner className="py-24" />;

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">الأقسام والمحتوى</h1>
          <p className="page-subtitle">إنشاء أقسام — كل قسم يحتوي قنوات أو أفلام — مع رفع ملفات الفيديو</p>
        </div>
        <button type="button" onClick={() => { resetForm(); setShowForm(true); }} className="btn btn-primary">
          <FolderPlus className="w-4 h-4" /> قسم جديد
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSaveCategory} className="card mb-6 max-w-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-800">{editId ? 'تعديل القسم' : 'قسم جديد'}</h2>
            <button type="button" onClick={resetForm} className="btn-icon"><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm text-slate-600">اسم القسم</span>
              <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="block">
              <span className="text-sm text-slate-600">الوصف</span>
              <input className="input mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm text-slate-600">نوع القسم</span>
              <select className="input mt-1" value={form.section_type} onChange={(e) => setForm({ ...form, section_type: e.target.value })}>
                {sectionTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-slate-600">ترتيب العرض</span>
              <input type="number" className="input mt-1" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value, 10) || 0 })} />
            </label>
            <button type="submit" className="btn btn-primary">{editId ? 'حفظ' : 'إنشاء'}</button>
          </div>
        </form>
      )}

      {categories.length === 0 ? (
        <div className="card text-center py-16">
          <FolderPlus className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">لا توجد أقسام — أنشئ قسمك الأول</p>
        </div>
      ) : (
        <div className="space-y-4">
          {categories.map((cat) => {
            const isOpen = expandedId === cat.id;
            const sectionLabel = sectionTypes.find((t) => t.value === cat.section_type)?.label || cat.section_type;

            return (
              <div key={cat.id} className="card !p-0 overflow-hidden">
                <div className="flex items-center gap-4 p-4">
                  <button type="button" onClick={() => loadExpanded(cat.id)} className="flex-1 flex items-center gap-3 text-right min-w-0">
                    {isOpen ? <ChevronUp className="w-5 h-5 text-slate-400 shrink-0" /> : <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-slate-800 truncate">{cat.name}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{sectionLabel}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <span className="admin-tag admin-tag-blue flex items-center gap-1">
                        <Radio className="w-3 h-3" /> {cat.live_count || 0}
                      </span>
                      <span className="admin-tag flex items-center gap-1">
                        <Film className="w-3 h-3" /> {cat.movie_count || 0}
                      </span>
                    </div>
                  </button>
                  <button type="button" onClick={() => handleEdit(cat)} className="btn-icon" title="تعديل"><Pencil className="w-4 h-4" /></button>
                  <button type="button" onClick={() => handleDeleteCategory(cat.id)} className="btn-icon text-red-500" title="حذف"><Trash2 className="w-4 h-4" /></button>
                </div>

                {isOpen && expandedData && (
                  <div className="border-t border-slate-200 p-4 bg-slate-50/50">
                    {(cat.section_type === 'mixed' || cat.section_type === 'movies') && (
                      <form onSubmit={(e) => handleUpload(cat.id, e)} className="mb-6 p-4 bg-white rounded-xl border border-slate-200">
                        <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                          <Upload className="w-4 h-4 text-blue-600" /> رفع فيلم
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                          <label className="block">
                            <span className="text-xs text-slate-500">اسم الفيلم (اختياري)</span>
                            <input className="input mt-1" value={movieForm.name} onChange={(e) => setMovieForm({ ...movieForm, name: e.target.value })} placeholder="يُؤخذ من اسم الملف" />
                          </label>
                          <label className="block">
                            <span className="text-xs text-slate-500">الوصف</span>
                            <input className="input mt-1" value={movieForm.description} onChange={(e) => setMovieForm({ ...movieForm, description: e.target.value })} />
                          </label>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                          <label className="flex-1 w-full">
                            <span className="text-xs text-slate-500">ملف الفيديو (MP4, MKV, AVI...)</span>
                            <input ref={fileRef} type="file" accept="video/*,.mp4,.mkv,.avi,.mov,.webm" className="input mt-1" required />
                          </label>
                          <label className="flex items-center gap-2 text-sm text-slate-600 pb-2">
                            <input type="checkbox" checked={movieForm.is_public} onChange={(e) => setMovieForm({ ...movieForm, is_public: e.target.checked })} />
                            ظاهر للمشاهدين
                          </label>
                          <button type="submit" className="btn btn-primary" disabled={uploading}>
                            {uploading ? uploadProgress || 'جاري الرفع...' : <><Plus className="w-4 h-4" /> رفع</>}
                          </button>
                        </div>
                      </form>
                    )}

                    <h4 className="text-sm font-bold text-slate-600 mb-3">المحتوى ({expandedData.items?.length || 0})</h4>
                    {!expandedData.items?.length ? (
                      <p className="text-sm text-slate-400">لا يوجد محتوى — أضف قنوات من صفحة القنوات أو ارفع أفلاماً</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {expandedData.items.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3 p-3 bg-white rounded-lg border border-slate-200">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm text-slate-800 truncate">{item.name}</p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {item.content_type === 'vod' ? (
                                  <><Film className="w-3 h-3 inline" /> فيلم · {formatBytes(item.file_size)}</>
                                ) : (
                                  <><Radio className="w-3 h-3 inline" /> قناة · {item.status}</>
                                )}
                              </p>
                            </div>
                            {item.content_type === 'vod' && (
                              <button type="button" onClick={() => handleDeleteMovie(item.id)} className="btn-icon text-red-500 shrink-0">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
