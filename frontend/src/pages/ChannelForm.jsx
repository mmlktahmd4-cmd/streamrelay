import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getChannel, createChannel, updateChannel, getCategories } from '../api/client';
import { ArrowRight } from 'lucide-react';

export default function ChannelForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '', source_type: 'hls', source_url: '', backup_source_url: '',
    output_format: 'hls', category_id: '', transcode_enabled: false,
    auto_restart: true, is_public: true, description: '',
  });

  useEffect(() => {
    getCategories().then(({ data }) => setCategories(data)).catch(() => {});
    if (isEdit) {
      getChannel(id).then(({ data }) => {
        setForm({
          name: data.name, source_type: data.source_type, source_url: data.source_url,
          backup_source_url: data.backup_source_url || '', output_format: data.output_format,
          category_id: data.category_id || '', transcode_enabled: data.transcode_enabled,
          auto_restart: data.auto_restart, is_public: data.is_public, description: data.description || '',
        });
      });
    }
  }, [id, isEdit]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = { ...form };
      if (!payload.category_id) delete payload.category_id;
      if (!payload.backup_source_url?.trim()) delete payload.backup_source_url;
      if (!payload.description?.trim()) delete payload.description;
      if (isEdit) await updateChannel(id, payload);
      else await createChannel(payload);
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

      <h1 className="page-title mb-6">{isEdit ? 'تعديل القناة' : 'إضافة قناة جديدة'}</h1>

      <form onSubmit={handleSubmit} className="card space-y-4">
        {error && <div className="admin-alert admin-alert-error">{error}</div>}

        <div>
          <label className="label">اسم القناة *</label>
          <input className="input" name="name" value={form.name} onChange={handleChange} required />
        </div>

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
          <label className="label">التصنيف</label>
          <select className="input" name="category_id" value={form.category_id} onChange={handleChange}>
            <option value="">بدون تصنيف</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label className="label">الوصف</label>
          <textarea className="input" name="description" value={form.description} onChange={handleChange} rows={2} />
        </div>

        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
            <input type="checkbox" name="auto_restart" checked={form.auto_restart} onChange={handleChange} className="rounded border-slate-300 text-blue-600" />
            إعادة تشغيل تلقائي
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
            <input type="checkbox" name="transcode_enabled" checked={form.transcode_enabled} onChange={handleChange} className="rounded border-slate-300 text-blue-600" />
            تفعيل Transcoding
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
            <input type="checkbox" name="is_public" checked={form.is_public} onChange={handleChange} className="rounded border-slate-300 text-blue-600" />
            قناة عامة للمشاهدين
          </label>
        </div>

        <div className="admin-alert admin-alert-info text-sm">
          بعد التشغيل، يظهر <strong>رابط البث الداخلي</strong> في صفحة القنوات — يمكن نسخه للمشاهدين أو VLC.
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'جاري الحفظ...' : isEdit ? 'حفظ التعديلات' : 'إنشاء القناة'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/channels')}>إلغاء</button>
        </div>
      </form>
    </div>
  );
}
