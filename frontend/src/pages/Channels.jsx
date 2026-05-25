import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getChannels, startChannel, stopChannel, restartChannel, deleteChannel, downloadViewerPlaylist, duplicateChannel } from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import RelayUrlCopy from '../components/ui/RelayUrlCopy';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ChannelImportPanel from '../components/admin/ChannelImportPanel';
import { Plus, Play, Square, RotateCcw, Trash2, Eye, Search, Download, Pencil, Radio, Copy } from 'lucide-react';

export default function Channels() {
  const { isOperator } = useAuth();
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState(null);

  const fetchChannels = async () => {
    try {
      const { data } = await getChannels({ limit: 100, search: search || undefined });
      setChannels(data.channels || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    fetchChannels();
    const interval = setInterval(fetchChannels, 3000);
    return () => clearInterval(interval);
  }, [search]);

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
                <Plus className="w-4 h-4" /> إضافة قناة
              </Link>
            </>
          )}
        </div>
      </div>

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
              <Plus className="w-4 h-4" /> إضافة قناة
            </Link>
          )}
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table admin-channel-table">
            <thead>
              <tr>
                <th>القناة</th>
                <th className="hidden md:table-cell">النوع</th>
                <th>الحالة</th>
                <th className="hidden lg:table-cell">رابط البث</th>
                <th className="text-left w-[1%]">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((ch) => (
                <tr key={ch.id} className={actionLoading === ch.id ? 'opacity-60' : ''}>
                  <td>
                    <p className="channel-name">{ch.name}</p>
                    <p className="channel-slug">{ch.slug}</p>
                    {ch.category_name && (
                      <span className="admin-tag mt-1 inline-block text-[10px] py-0">{ch.category_name}</span>
                    )}
                  </td>
                  <td className="hidden md:table-cell">
                    <span className="admin-tag text-[10px] py-0">{ch.source_type?.toUpperCase()}</span>
                    {ch.is_public && <span className="admin-tag admin-tag-blue text-[10px] py-0 mr-1">عامة</span>}
                  </td>
                  <td>
                    <StatusBadge status={ch.status} />
                  </td>
                  <td className="hidden lg:table-cell">
                    {isOperator && ch.status === 'running' ? (
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
                      {isOperator && (
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
