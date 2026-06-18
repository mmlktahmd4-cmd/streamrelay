import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getChannels,
  startChannel,
  stopChannel,
  restartChannel,
  deleteChannel,
  downloadViewerPlaylist,
  duplicateChannel,
  bulkUpdateChannels,
  bulkStreamAction,
  bulkDeleteChannels,
  runBulkDiagnostics,
  runBulkFix,
  fixChannel,
  getCategoriesFull,
  deleteMovie,
  proxiedImageUrl,
} from '../api/client';
import ChannelDiagnosticsModal from '../components/admin/ChannelDiagnosticsModal';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import RelayUrlCopy from '../components/ui/RelayUrlCopy';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ChannelImportPanel from '../components/admin/ChannelImportPanel';
import { Plus, Play, Square, RotateCcw, Trash2, Eye, Search, Download, Pencil, Radio, Copy, CheckSquare, Stethoscope } from 'lucide-react';

export default function Channels() {
  const { isOperator } = useAuth();
  const [channels, setChannels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkPublic, setBulkPublic] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResults, setDiagResults] = useState(null);
  const [fixingId, setFixingId] = useState(null);
  const [fetchError, setFetchError] = useState('');

  const fetchChannels = async () => {
    try {
      const { data } = await getChannels({ limit: 500, search: search || undefined });
      setChannels(data.channels || []);
      setFetchError('');
    } catch (err) {
      setFetchError(err.response?.data?.error || 'تعذّر تحميل القنوات — تحقق من اتصال السيرفر');
    }
    setLoading(false);
  };

  useEffect(() => {
    getCategoriesFull().then(({ data }) => setCategories(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetchChannels();
    const interval = setInterval(fetchChannels, 10000);
    return () => clearInterval(interval);
  }, [search]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // الأفلام (vod) لا تدخل في إجراءات البث الجماعية — نحدد القنوات المباشرة فقط
  const liveChannels = channels.filter((ch) => ch.content_type !== 'vod');

  const toggleSelectAll = () => {
    if (selected.size === liveChannels.length && liveChannels.length > 0) setSelected(new Set());
    else setSelected(new Set(liveChannels.map((ch) => ch.id)));
  };

  const applyBulkStream = async (action, all = false) => {
    const labels = { start: 'تشغيل', stop: 'إيقاف', restart: 'إعادة تشغيل' };
    if (!all && selected.size === 0) {
      alert('حدد قنوات أولاً أو استخدم "على الكل"');
      return;
    }
    const scope = all ? 'كل القنوات' : `${selected.size} قناة`;
    if (!confirm(`${labels[action]} ${scope}؟`)) return;

    setBulkLoading(true);
    try {
      const payload = all
        ? { all: true, action }
        : { ids: [...selected], action };
      const { data } = await bulkStreamAction(payload);
      alert(`تم جدولة ${labels[action]} لـ ${data.queued} قناة`);
      setSelected(new Set());
      await fetchChannels();
    } catch (err) {
      alert(err.response?.data?.error || 'فشل تنفيذ الإجراء');
    } finally {
      setBulkLoading(false);
    }
  };

  const applyBulk = async (all = false) => {
    const updates = {};
    if (bulkCategory === '__none__') updates.category_id = null;
    else if (bulkCategory) updates.category_id = bulkCategory;
    if (bulkPublic === 'true') updates.is_public = true;
    if (bulkPublic === 'false') updates.is_public = false;

    if (Object.keys(updates).length === 0) {
      alert('اختر تصنيف أو حالة الظهور للتحديث');
      return;
    }
    if (!all && selected.size === 0) {
      alert('حدد قنوات أو استخدم "تطبيق على الكل"');
      return;
    }

    setBulkLoading(true);
    try {
      const payload = all
        ? { all: true, updates }
        : { ids: [...selected], updates };
      const { data } = await bulkUpdateChannels(payload);
      alert(`تم تحديث ${data.updated} قناة`);
      setSelected(new Set());
      await fetchChannels();
    } catch (err) {
      alert(err.response?.data?.error || 'فشل التحديث');
    } finally {
      setBulkLoading(false);
    }
  };

  const applyBulkDelete = async (all = false) => {
    if (!all && selected.size === 0) {
      alert('حدد قنوات أولاً');
      return;
    }
    const scope = all ? 'كل القنوات' : `${selected.size} قناة`;
    if (!confirm(`حذف ${scope} نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`)) return;

    setBulkLoading(true);
    try {
      const payload = all ? { all: true } : { ids: [...selected] };
      const { data } = await bulkDeleteChannels(payload);
      if (data.failed?.length) {
        alert(`تم حذف ${data.deleted} من ${data.total}. فشل حذف: ${data.failed.map((f) => f.name || f.id).join('، ')}`);
      } else {
        alert(`تم حذف ${data.deleted} قناة`);
      }
      setSelected(new Set());
      await fetchChannels();
    } catch (err) {
      alert(err.response?.data?.error || 'فشل الحذف');
    } finally {
      setBulkLoading(false);
    }
  };

  const runDiagnostics = async (all = false) => {
    if (!all && selected.size === 0) {
      alert('حدد قنوات للفحص أو استخدم «فحص الكل»');
      return;
    }
    setDiagOpen(true);
    setDiagLoading(true);
    setDiagResults(null);
    try {
      const payload = all ? { all: true } : { ids: [...selected] };
      const { data } = await runBulkDiagnostics(payload);
      setDiagResults(data);
    } catch (err) {
      alert(err.response?.data?.error || 'فشل الفحص');
      setDiagOpen(false);
    } finally {
      setDiagLoading(false);
    }
  };

  const handleDiagFix = async (channelId) => {
    setFixingId(channelId);
    try {
      const { data } = await fixChannel(channelId);
      alert(data.message || (data.fixed ? 'تم الإصلاح' : 'لم يُصلح'));
      const ids = diagResults?.channels?.map((c) => c.channel_id) || [channelId];
      const { data: refreshed } = await runBulkDiagnostics({ ids });
      setDiagResults(refreshed);
      await fetchChannels();
    } catch (err) {
      alert(err.response?.data?.error || 'فشل الإصلاح');
    } finally {
      setFixingId(null);
    }
  };

  const handleDiagFixAll = async () => {
    const ids = (diagResults?.channels || [])
      .filter((c) => !c.ok && c.issues?.some((i) => i.fix === 'restart'))
      .map((c) => c.channel_id);
    if (!ids.length) return;
    if (!confirm(`إصلاح ${ids.length} قناة؟`)) return;
    setFixingId('bulk');
    try {
      const { data } = await runBulkFix({ ids });
      alert(`تم إصلاح ${data.fixed} من ${data.total} قناة`);
      const { data: refreshed } = await runBulkDiagnostics({ ids });
      setDiagResults(refreshed);
      await fetchChannels();
    } catch (err) {
      alert(err.response?.data?.error || 'فشل الإصلاح');
    } finally {
      setFixingId(null);
    }
  };

  const handleDeleteMovie = async (id) => {
    if (!confirm('هل أنت متأكد من حذف هذا الفيلم؟ سيُحذف الملف نهائياً.')) return;
    setActionLoading(id);
    try {
      await deleteMovie(id);
      await fetchChannels();
    } catch (err) {
      alert(err.response?.data?.error || 'فشل حذف الفيلم');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAction = async (id, action) => {
    setActionLoading(id);
    try {
      if (action === 'start') await startChannel(id);
      else if (action === 'stop') await stopChannel(id);
      else if (action === 'restart') await restartChannel(id);
      else if (action === 'delete') {
        if (!confirm('هل أنت متأكد من حذف هذه القناة؟')) return;
        await deleteChannel(id);
      } else if (action === 'duplicate') {
        await duplicateChannel(id);
      } else if (action === 'diagnose') {
        setDiagOpen(true);
        setDiagLoading(true);
        setDiagResults(null);
        try {
          const { data } = await runBulkDiagnostics({ ids: [id] });
          setDiagResults(data);
        } catch (diagErr) {
          alert(diagErr.response?.data?.error || 'فشل فحص القناة');
          setDiagOpen(false);
        } finally {
          setDiagLoading(false);
        }
        return;
      }
      await fetchChannels();
    } catch (err) {
      alert(err.response?.data?.error || err.response?.data?.message || 'حدث خطأ');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="page-title">إدارة القنوات</h1>
          <p className="page-subtitle">تشغيل القنوات ونسخ روابط البث الداخلي</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative sm:w-56">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className="input pr-10 py-2 text-sm" placeholder="بحث..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {isOperator && (
            <>
              <ChannelImportPanel onDone={fetchChannels} />
              <Link to="/channels/new" className="btn btn-primary btn-sm whitespace-nowrap">
                <Plus className="w-4 h-4" /> إضافة قناة / فيلم
              </Link>
            </>
          )}
        </div>
      </div>

      {isOperator && channels.length > 0 && (
        <div className="card mb-4 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <CheckSquare className="w-4 h-4" />
            <button type="button" className="underline" onClick={toggleSelectAll}>
              {selected.size === liveChannels.length && liveChannels.length > 0 ? 'إلغاء التحديد' : 'تحديد الكل'}
            </button>
            <span className="text-slate-400">({selected.size} محدد)</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" disabled={bulkLoading} onClick={() => applyBulkStream('start', false)}>
              <Play className="w-3.5 h-3.5" /> تشغيل المحدد
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={bulkLoading} onClick={() => applyBulkStream('stop', false)}>
              <Square className="w-3.5 h-3.5" /> إيقاف المحدد
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={bulkLoading} onClick={() => applyBulkStream('restart', false)}>
              <RotateCcw className="w-3.5 h-3.5" /> إعادة تشغيل المحدد
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm text-red-700 border-red-200 hover:bg-red-50"
              disabled={bulkLoading || selected.size === 0}
              onClick={() => applyBulkDelete(false)}
            >
              <Trash2 className="w-3.5 h-3.5" /> حذف المحدد
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={bulkLoading || selected.size === 0}
              onClick={() => runDiagnostics(false)}
            >
              <Stethoscope className="w-3.5 h-3.5" /> فحص المحدد
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={bulkLoading} onClick={() => runDiagnostics(true)}>
              <Stethoscope className="w-3.5 h-3.5" /> فحص الكل
            </button>
            <span className="hidden sm:inline w-px h-8 bg-slate-200 mx-1" />
            <button type="button" className="btn btn-primary btn-sm" disabled={bulkLoading} onClick={() => applyBulkStream('start', true)}>
              <Play className="w-3.5 h-3.5" /> تشغيل الكل
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={bulkLoading} onClick={() => applyBulkStream('stop', true)}>
              <Square className="w-3.5 h-3.5" /> إيقاف الكل
            </button>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-end gap-3 pt-2 border-t border-slate-100">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select className="input py-2 text-sm" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}>
                <option value="">— تغيير القسم —</option>
                <option value="__none__">بدون قسم</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="input py-2 text-sm" value={bulkPublic} onChange={(e) => setBulkPublic(e.target.value)}>
                <option value="">— الظهور —</option>
                <option value="true">عامة للمشاهدين</option>
                <option value="false">خاصة</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary btn-sm" disabled={bulkLoading} onClick={() => applyBulk(false)}>
                تطبيق على المحدد
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={bulkLoading} onClick={() => applyBulk(true)}>
                تطبيق على كل القنوات
              </button>
            </div>
          </div>
        </div>
      )}

      {fetchError && (
        <div className="admin-alert admin-alert-error mb-4 flex items-center justify-between gap-2">
          <span>{fetchError}</span>
          <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={fetchChannels}>إعادة المحاولة</button>
        </div>
      )}

      <div className="admin-alert admin-alert-info mb-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 shrink-0" />
          <span>البث الداخلي — السيرفر يسحب المصدر مرة واحدة</span>
        </div>
        {isOperator && (
          <button type="button" onClick={() => downloadViewerPlaylist().catch(() => alert('فشل تحميل القائمة'))} className="btn btn-secondary btn-sm shrink-0">
            <Download className="w-3.5 h-3.5" /> M3U
          </button>
        )}
      </div>

      {loading ? (
        <LoadingSpinner className="py-16" />
      ) : channels.length === 0 ? (
        <div className="card text-center py-12">
          <Radio className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">لا توجد قنوات</p>
          {isOperator && (
            <Link to="/channels/new" className="btn btn-primary btn-sm mt-4 inline-flex">
              <Plus className="w-4 h-4" /> إضافة قناة / فيلم
            </Link>
          )}
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table admin-channel-table">
            <thead>
              <tr>
                {isOperator && <th className="w-8" />}
                <th>القناة</th>
                <th className="hidden md:table-cell">النوع</th>
                <th className="hidden lg:table-cell">السيرفر</th>
                <th>الحالة</th>
                <th className="hidden lg:table-cell">رابط البث</th>
                <th className="text-left w-[1%]">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((ch) => {
                const isMovie = ch.content_type === 'vod';
                return (
                <tr key={`${isMovie ? 'movie' : 'ch'}-${ch.id}`} className={actionLoading === ch.id ? 'opacity-60' : ''}>
                  {isOperator && (
                    <td>
                      {isMovie ? (
                        <span className="block w-4" />
                      ) : (
                        <input type="checkbox" checked={selected.has(ch.id)} onChange={() => toggleSelect(ch.id)} className="rounded border-slate-300" />
                      )}
                    </td>
                  )}
                  <td>
                    <div className="flex items-center gap-3">
                      {ch.logo_url ? (
                        <img src={proxiedImageUrl(ch.logo_url)} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <Radio className="w-4 h-4 text-slate-400" />
                        </div>
                      )}
                      <div>
                        <p className="channel-name">{ch.name}</p>
                        <p className="channel-slug">{ch.slug}</p>
                        {ch.category_name && (
                          <span className="admin-tag mt-1 inline-block text-[10px] py-0">{ch.category_name}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="hidden md:table-cell">
                    {isMovie ? (
                      <span className="admin-tag admin-tag-purple text-[10px] py-0">فيلم</span>
                    ) : (
                      <span className="admin-tag text-[10px] py-0">{ch.source_type?.toUpperCase()}</span>
                    )}
                    {ch.is_public && <span className="admin-tag admin-tag-blue text-[10px] py-0 mr-1">عامة</span>}
                  </td>
                  <td className="hidden lg:table-cell text-xs text-slate-600">
                    {ch.server_name ? (
                      <span title={ch.server_hostname}>{ch.server_name}</span>
                    ) : (
                      <span className="text-slate-400">تلقائي</span>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-col gap-1 items-start max-w-[200px]">
                      {isMovie ? (
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">جاهز للعرض</span>
                      ) : (
                        <>
                          <StatusBadge status={ch.status} />
                          {ch.on_demand && (
                            <span className="text-[10px] font-semibold text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded">On Demand</span>
                          )}
                          {ch.last_error && (ch.status === 'error' || ch.status === 'starting') && (
                            <span className="text-[10px] text-red-600 line-clamp-2" title={ch.last_error}>{ch.last_error}</span>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                  <td className="hidden lg:table-cell">
                    {!isMovie && isOperator && ch.status === 'running' ? (
                      <RelayUrlCopy channelId={ch.id} status={ch.status} />
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td>
                    <div className="admin-channel-actions">
                      <Link to={`/player/${ch.id}`} className="btn-icon !p-1.5" title="معاينة">
                        <Eye className="w-3.5 h-3.5" />
                      </Link>
                      {isOperator && isMovie && (
                        <>
                          <Link to="/categories" className="btn-icon !p-1.5" title="تعديل الفيلم (الأقسام)">
                            <Pencil className="w-3.5 h-3.5" />
                          </Link>
                          <button className="btn-icon btn-icon-danger !p-1.5" onClick={() => handleDeleteMovie(ch.id)} disabled={actionLoading === ch.id} title="حذف الفيلم">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {isOperator && !isMovie && (
                        <>
                          {ch.status !== 'running' ? (
                            <button className="btn-icon btn-icon-success !p-1.5" onClick={() => handleAction(ch.id, 'start')} disabled={actionLoading === ch.id} title="تشغيل">
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button className="btn-icon btn-icon-warning !p-1.5" onClick={() => handleAction(ch.id, 'stop')} disabled={actionLoading === ch.id} title="إيقاف">
                              <Square className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {ch.status === 'running' && (
                            <span className="lg:hidden">
                              <RelayUrlCopy channelId={ch.id} status={ch.status} compact />
                            </span>
                          )}
                          <button className="btn-icon !p-1.5" onClick={() => handleAction(ch.id, 'restart')} disabled={actionLoading === ch.id} title="إعادة تشغيل">
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button className="btn-icon !p-1.5" onClick={() => handleAction(ch.id, 'diagnose')} disabled={actionLoading === ch.id} title="فحص">
                            <Stethoscope className="w-3.5 h-3.5" />
                          </button>
                          <Link to={`/channels/${ch.id}/edit`} className="btn-icon !p-1.5" title="تعديل">
                            <Pencil className="w-3.5 h-3.5" />
                          </Link>
                          <button className="btn-icon !p-1.5" onClick={() => handleAction(ch.id, 'duplicate')} disabled={actionLoading === ch.id} title="نسخ">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button className="btn-icon btn-icon-danger !p-1.5" onClick={() => handleAction(ch.id, 'delete')} disabled={actionLoading === ch.id} title="حذف">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ChannelDiagnosticsModal
        open={diagOpen}
        onClose={() => setDiagOpen(false)}
        results={diagResults}
        loading={diagLoading}
        onRunFix={handleDiagFix}
        onRunFixAll={handleDiagFixAll}
        fixingId={fixingId}
      />
    </div>
  );
}
