import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getChannel,
  createChannel,
  updateChannel,
  getCategoriesFull,
  uploadMovie,
  updateMovie,
  getServers,
} from '../api/client';
import { ArrowRight, Film, Radio } from 'lucide-react';

const LIVE_DEFAULT = {
  name: '',
  source_type: 'hls',
  source_url: '',
  backup_source_url: '',
  output_format: 'hls',
  category_id: '',
  transcode_enabled: false,
  auto_restart: true,
  on_demand: false,
  is_public: true,
  description: '',
  logo_url: '',
  server_id: '',
};

export default function ChannelForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [categories, setCategories] = useState([]);
  const [streamServers, setStreamServers] = useState([]);
  const [contentType, setContentType] = useState('live');
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [movieFile, setMovieFile] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ ...LIVE_DEFAULT });

  useEffect(() => {
    getCategoriesFull().then(({ data }) => setCategories(data || [])).catch(() => {});
    getServers().then(({ data }) => {
      const list = (data.servers || []).filter(
        (s) => s.is_active && (s.role === 'stream-only' || s.role === 'full')
      );
      setStreamServers(list);
    }).catch(() => {});
    if (isEdit) {
      getChannel(id).then(({ data }) => {
        const isMovie = data.content_type === 'vod';
        setContentType(isMovie ? 'movie' : 'live');
        setForm({
          name: data.name || '',
          source_type: data.source_type || 'hls',
          source_url: data.source_url || '',
          backup_source_url: data.backup_source_url || '',
          output_format: data.output_format || 'hls',
          category_id: data.category_id || '',
          transcode_enabled: data.transcode_enabled || false,
          auto_restart: data.auto_restart !== false,
          on_demand: !!data.on_demand,
          is_public: data.is_public !== false,
          description: data.description || '',
          logo_url: data.logo_url || data.poster_url || '',
          server_id: data.server_id || '',
        });
      });
    }
  }, [id, isEdit]);

  const filteredCategories = categories.filter((cat) => {
    const type = cat.section_type || 'mixed';
    if (contentType === 'movie') return type === 'mixed' || type === 'movies';
    return type === 'mixed' || type === 'live';
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setUploadProgress(0);

    try {
      if (contentType === 'movie') {
        if (!form.category_id) {
          setError('اختر قسم للفيلم');
          return;
        }
        if (!isEdit && !movieFile) {
          setError('اختر ملف الفيلم (MP4, MKV, ...)');
          return;
        }

        const moviePayload = {
          name: form.name,
          description: form.description || undefined,
          category_id: form.category_id,
          is_public: form.is_public,
          poster_url: form.logo_url || undefined,
        };

        if (isEdit) {
          await updateMovie(id, moviePayload);
        } else {
          await uploadMovie(form.category_id, movieFile, {
            ...moviePayload,
            onProgress: setUploadProgress,
          });
        }
      } else {
        const payload = { ...form };
        if (!payload.category_id) delete payload.category_id;
        if (!payload.backup_source_url?.trim()) delete payload.backup_source_url;
        if (!payload.description?.trim()) delete payload.description;
        if (!payload.logo_url?.trim()) delete payload.logo_url;
        payload.server_id = payload.server_id || null;
        if (isEdit) await updateChannel(id, payload);
        else await createChannel(payload);
      }
      navigate('/channels');
    } catch (err) {
      const details = err.response?.data?.details;
      setError(details
        ? Object.entries(details).map(([k, v]) => `${k}: ${(Array.isArray(v) ? v : [v]).join(', ')}`).join(' | ')
        : err.response?.data?.error || err.response?.data?.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <button onClick={() => navigate('/channels')} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 mb-5 text-sm font-medium">
        <ArrowRight className="w-4 h-4" /> العودة للقنوات
      </button>

      <h1 className="page-title mb-6">{isEdit ? 'تعديل المحتوى' : 'إضافة قناة / فيلم'}</h1>

      <form onSubmit={handleSubmit} className="card space-y-4">
        {error && <div className="admin-alert admin-alert-error">{error}</div>}

        {!isEdit && (
          <div>
            <label className="label">نوع المحتوى *</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setContentType('live')}
                className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition ${contentType === 'live' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}
              >
                <Radio className="w-4 h-4" /> بث مباشر
              </button>
              <button
                type="button"
                onClick={() => setContentType('movie')}
                className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition ${contentType === 'movie' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600'}`}
              >
                <Film className="w-4 h-4" /> فيلم
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="label">{contentType === 'movie' ? 'اسم الفيلم *' : 'اسم القناة *'}</label>
          <input className="input" name="name" value={form.name} onChange={handleChange} required />
        </div>

        <div>
          <label className="label">رابط الصورة (اختياري)</label>
          <input className="input" name="logo_url" value={form.logo_url} onChange={handleChange} dir="ltr" placeholder="https://example.com/logo.png" />
          {form.logo_url && (
            <img src={form.logo_url} alt="" className="mt-2 h-16 w-16 rounded-lg object-cover border border-slate-200" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          )}
        </div>

        {contentType === 'live' ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">نوع المصدر</label>
                <select className="input" name="source_type" value={form.source_type} onChange={handleChange}>
                  <option value="hls">HLS (.m3u8)</option>
                  <option value="http">HTTP Stream</option>
                  <option value="rtmp">RTMP</option>
                  <option value="udp">UDP</option>
                  <option value="m3u">M3U</option>
                </select>
              </div>
              <div>
                <label className="label">صيغة الإخراج</label>
                <select className="input" name="output_format" value={form.output_format} onChange={handleChange}>
                  <option value="hls">HLS</option>
                  <option value="mpegts">MPEGTS</option>
                  <option value="rtmp">RTMP</option>
                  <option value="relay">Internal Relay</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">رابط المصدر *</label>
              <input className="input" name="source_url" value={form.source_url} onChange={handleChange} required dir="ltr" placeholder="https://example.com/stream.m3u8" />
            </div>

            <div>
              <label className="label">رابط احتياطي</label>
              <input className="input" name="backup_source_url" value={form.backup_source_url} onChange={handleChange} dir="ltr" />
            </div>

            <div>
              <label className="label">سيرفر البث</label>
              <select className="input" name="server_id" value={form.server_id} onChange={handleChange}>
                <option value="">تلقائي — أقل حمل</option>
                {streamServers.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.is_suspended && s.id !== form.server_id}>
                    {s.name} ({s.hostname})
                    {s.is_suspended ? ' — معلّق' : s.online ? '' : ' — غير متصل'}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">اختر سيرفراً محدداً أو اترك «تلقائي» للتوزيع الذكي (السيرفرات المعلّقة غير متاحة)</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
              <div>
                <p className="text-sm font-bold text-slate-800">وضع التشغيل</p>
                <p className="text-xs text-slate-500 mt-0.5">اختر كيف تبدأ القناة بعد الإنشاء</p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-cyan-200 bg-white px-3 py-3 has-[:checked]:ring-2 has-[:checked]:ring-cyan-400">
                <input
                  type="checkbox"
                  name="on_demand"
                  checked={form.on_demand}
                  onChange={handleChange}
                  className="rounded border-slate-300 text-cyan-600 mt-0.5"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-800">On Demand — تشغيل عند الطلب فقط</span>
                  <span className="block text-xs text-slate-500 mt-1">
                    القناة لا تشتغل 24/7. تبدأ عندما يفتحها المشاهد وتتوقف تلقائياً بعد ~10 دقائق بدون مشاهدة (مثل Xtream).
                  </span>
                </span>
              </label>
              <div className="flex flex-wrap gap-5 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                  <input type="checkbox" name="auto_restart" checked={form.auto_restart} onChange={handleChange} className="rounded border-slate-300 text-blue-600" />
                  إعادة تشغيل تلقائي عند الانقطاع
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                  <input type="checkbox" name="transcode_enabled" checked={form.transcode_enabled} onChange={handleChange} className="rounded border-slate-300 text-blue-600" />
                  تفعيل Transcoding
                </label>
              </div>
            </div>
          </>
        ) : (
          !isEdit && (
            <div>
              <label className="label">ملف الفيلم *</label>
              <input
                type="file"
                className="input"
                accept="video/mp4,video/x-matroska,video/quicktime,video/webm,video/x-msvideo,.mp4,.mkv,.mov,.webm,.avi,.m4v"
                onChange={(e) => setMovieFile(e.target.files?.[0] || null)}
              />
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="mt-2">
                  <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div className="h-full bg-violet-500 transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">جاري الرفع: {uploadProgress}%</p>
                </div>
              )}
              <p className="text-xs text-slate-500 mt-1">MP4, MKV, MOV, WEBM, AVI — حتى 4GB</p>
            </div>
          )
        )}

        <div>
          <label className="label">القسم *</label>
          <select className="input" name="category_id" value={form.category_id} onChange={handleChange} required={contentType === 'movie'}>
            <option value="">{contentType === 'movie' ? 'اختر قسم...' : 'بدون تصنيف'}</option>
            {filteredCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">الوصف</label>
          <textarea className="input" name="description" value={form.description} onChange={handleChange} rows={2} />
        </div>

        <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
          <input type="checkbox" name="is_public" checked={form.is_public} onChange={handleChange} className="rounded border-slate-300 text-blue-600" />
          {contentType === 'movie' ? 'فيلم عام للمشاهدين' : 'قناة عامة للمشاهدين'}
        </label>

        {contentType === 'live' && (
          <div className={`admin-alert text-sm ${form.on_demand ? 'admin-alert-info' : 'admin-alert-info'}`}>
            {form.on_demand ? (
              <>القناة ستُنشأ <strong>متوقفة</strong> — تُشغَّل تلقائياً عند أول مشاهدة من بوابة المشاهدة.</>
            ) : (
              <>بعد الإنشاء تُشغَّل القناة تلقائياً ويظهر <strong>رابط البث</strong> في صفحة القنوات.</>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? (uploadProgress > 0 ? `رفع ${uploadProgress}%...` : 'جاري الحفظ...') : isEdit ? 'حفظ التعديلات' : contentType === 'movie' ? 'رفع الفيلم' : 'إنشاء القناة'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/channels')}>إلغاء</button>
        </div>
      </form>
    </div>
  );
}
