import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getChannel, getPlaybackUrl } from '../api/client';
import { useAuth } from '../context/AuthContext';
import HlsPlayer from '../components/HlsPlayer';
import StatusBadge from '../components/StatusBadge';
import RelayUrlCopy from '../components/ui/RelayUrlCopy';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { ArrowRight } from 'lucide-react';

export default function Player() {
  const { id } = useParams();
  const { isOperator } = useAuth();
  const [channel, setChannel] = useState(null);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: ch } = await getChannel(id);
        setChannel(ch);
        if (ch.status === 'running') {
          const { data: url } = await getPlaybackUrl(id);
          setPlaybackUrl(url.url);
        }
      } catch { /* ignore */ }
      setLoading(false);
    };
    load();
  }, [id]);

  if (loading) return <LoadingSpinner className="py-24" />;
  if (!channel) return <div className="text-center py-20 text-slate-400">القناة غير موجودة</div>;

  return (
    <div className="max-w-5xl mx-auto">
      <Link to="/channels" className="inline-flex items-center gap-2 text-slate-500 hover:text-blue-600 mb-5 text-sm font-medium">
        <ArrowRight className="w-4 h-4" /> العودة للقنوات
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="page-title">{channel.name}</h1>
          <p className="page-subtitle font-mono">{channel.slug}</p>
        </div>
        <StatusBadge status={channel.status} />
      </div>

      {channel.status === 'running' && playbackUrl ? (
        <div className="space-y-4">
          <div className="rounded-lg overflow-hidden border border-slate-200 shadow-sm">
            <HlsPlayer src={playbackUrl} />
          </div>
          <div className="card space-y-4">
            <div className="admin-alert admin-alert-success">
              البث من <strong>إعادة البث المحلية</strong> — المصدر الخارجي يُسحب مرة واحدة فقط
            </div>
            {isOperator && <RelayUrlCopy channelId={channel.id} status={channel.status} />}
          </div>
        </div>
      ) : (
        <div className="aspect-video rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
          {channel.status === 'running' ? 'جاري تحميل البث...' : 'القناة غير نشطة — شغّل القناة أولاً'}
        </div>
      )}

      {isOperator && (
        <div className="card mt-5 space-y-0 text-sm">
          <h3 className="font-bold text-slate-800 mb-3 pb-2 border-b border-slate-100">تفاصيل تقنية</h3>
          <div className="flex justify-between gap-4 py-2.5 border-b border-slate-50">
            <span className="text-slate-500 shrink-0">المصدر الخارجي</span>
            <span dir="ltr" className="text-slate-700 truncate text-left text-xs font-mono">{channel.source_url}</span>
          </div>
          <div className="flex justify-between py-2.5 border-b border-slate-50">
            <span className="text-slate-500">PID</span>
            <span className="text-slate-700">{channel.pid || '-'}</span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-slate-500">إعادة التشغيل</span>
            <span className="text-slate-700">{channel.restart_count || 0}</span>
          </div>
          {channel.last_error && (
            <div className="admin-alert admin-alert-error text-xs mt-3">{channel.last_error}</div>
          )}
        </div>
      )}
    </div>
  );
}
