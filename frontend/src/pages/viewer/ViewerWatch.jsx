import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getChannel, getPlaybackUrl } from '../../api/client';
import { useViewerBranding } from '../../context/ViewerBrandingContext';
import HlsPlayer from '../../components/HlsPlayer';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { ArrowRight, Tv2, Film } from 'lucide-react';

export default function ViewerWatch() {
  const { id } = useParams();
  const branding = useViewerBranding();
  const [channel, setChannel] = useState(null);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [playbackType, setPlaybackType] = useState('live');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const { data: ch } = await getChannel(id);
        if (ch.is_public === false) {
          setError('هذا المحتوى غير متاح');
          setLoading(false);
          return;
        }
        setChannel(ch);

        const isVod = ch.content_type === 'vod';
        if (isVod || ch.status === 'running') {
          const { data: playback } = await getPlaybackUrl(id);
          setPlaybackUrl(playback.url);
          setPlaybackType(playback.type || (isVod ? 'vod' : 'live'));
        }
      } catch {
        setError('تعذّر تحميل المحتوى');
      }
      setLoading(false);
    };
    load();
  }, [id]);

  if (loading) return <LoadingSpinner className="py-32" />;

  if (error || !channel) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <Tv2 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <p className="text-slate-400">{error || 'المحتوى غير موجود'}</p>
        <Link to="/watch" className="viewer-btn-primary inline-block mt-6 px-8 py-2.5 w-auto">العودة</Link>
      </div>
    );
  }

  const isVod = playbackType === 'vod' || channel.content_type === 'vod';
  const canPlay = isVod || channel.status === 'running';

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <Link to="/watch" className="inline-flex items-center gap-2 text-slate-400 hover:text-teal-400 mb-5 text-sm font-medium">
        <ArrowRight className="w-4 h-4" /> العودة
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="viewer-page-title text-xl flex items-center gap-2">
            {isVod && <Film className="w-5 h-5 text-violet-400" />}
            {channel.name}
          </h1>
          {channel.description && <p className="viewer-page-sub">{channel.description}</p>}
        </div>
        {!isVod && <StatusBadge status={channel.status} />}
      </div>

      {canPlay && playbackUrl ? (
        <div className="space-y-4">
          <div className="viewer-player-wrap">
            {isVod ? (
              <video
                src={playbackUrl}
                controls
                autoPlay
                className="w-full h-full bg-black rounded-xl"
                style={{ maxHeight: '70vh' }}
              >
                <track kind="captions" />
              </video>
            ) : (
              <HlsPlayer src={playbackUrl} />
            )}
          </div>
          <div className="viewer-expiry-banner ok text-center text-sm">
            {isVod ? branding.vod_watch_notice : branding.live_watch_notice}
          </div>
        </div>
      ) : (
        <div className="viewer-channel-thumb rounded-xl aspect-video flex items-center justify-center">
          <p className="text-slate-500">{channel.status === 'running' ? 'جاري التحميل...' : 'القناة غير نشطة'}</p>
        </div>
      )}
    </div>
  );
}

