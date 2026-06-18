import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getChannel, getPlaybackUrl, getChannels, proxiedImageUrl } from '../../api/client';
import { useViewerBranding } from '../../context/ViewerBrandingContext';
import HlsPlayer from '../../components/HlsPlayer';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { ArrowRight, Tv2, Film, Play, ShieldCheck, Share2, Maximize, RotateCw, Layers } from 'lucide-react';

export default function ViewerWatch() {
  const { id } = useParams();
  const branding = useViewerBranding();
  const [channel, setChannel] = useState(null);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [playbackType, setPlaybackType] = useState('live');
  const [streamStarting, setStreamStarting] = useState(false);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const playerRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      setPlaybackUrl('');
      try {
        const { data: ch } = await getChannel(id);
        if (ch.is_public === false) {
          setError('هذا المحتوى غير متاح');
          setLoading(false);
          return;
        }
        setChannel(ch);

        const isVod = ch.content_type === 'vod';
        const canRequestPlayback = isVod || ch.on_demand || ch.status === 'running';
        if (canRequestPlayback) {
          try {
            const { data: playback } = await getPlaybackUrl(id);
            setPlaybackUrl(playback.url);
            setPlaybackType(playback.type || (isVod ? 'vod' : 'live'));
            setStreamStarting(!!playback.starting);
            if (playback.on_demand) {
              setChannel((prev) => (prev ? {
                ...prev,
                status: playback.status || (playback.starting ? 'starting' : prev.status),
              } : prev));
            }
          } catch (err) {
            if (ch.on_demand) {
              setError(err.response?.data?.error || 'تعذّر تشغيل القناة — حاول مرة أخرى');
            }
          }
        }

        // قنوات ذات صلة (نفس القسم، عامة، الأنشط أولاً)
        try {
          const { data } = await getChannels({ limit: 200 });
          const list = (data.channels || [])
            .filter((c) => c.is_public !== false && c.id !== ch.id)
            .filter((c) => (ch.category_id ? c.category_id === ch.category_id : true))
            .sort((a, b) => (a.status === 'running' ? -1 : 1) - (b.status === 'running' ? -1 : 1))
            .slice(0, 15);
          setRelated(list);
        } catch { /* ignore */ }
      } catch {
        setError('تعذّر تحميل المحتوى');
      }
      setLoading(false);
    };
    load();
    window.scrollTo(0, 0);
  }, [id]);

  const showToast = (msg) => {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(''), 2500);
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: channel?.name, url });
        return;
      } catch { /* المستخدم ألغى */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('تم نسخ رابط المشاهدة');
    } catch {
      showToast('تعذّر نسخ الرابط');
    }
  };

  const handleFullscreen = () => {
    const el = playerRef.current;
    if (!el) return;
    // ملء شاشة الحاوية كاملة حتى يبقى شريط اختيار الجودة ظاهراً للمشترك.
    // iOS Safari لا يدعم ملء شاشة الحاوية — نرجع لعنصر الفيديو هناك فقط.
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else {
      const video = el.querySelector('video');
      video?.webkitEnterFullscreen?.();
    }
  };

  const handleReload = () => {
    setReloadKey((k) => k + 1);
    showToast('جاري إعادة الاتصال بالبث...');
  };

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
  const isOnDemand = !!channel.on_demand;
  const canPlay = isVod || isOnDemand || channel.status === 'running';
  const isStarting = isOnDemand && streamStarting && !error;
  const image = proxiedImageUrl(channel.logo_url || channel.poster_url);

  return (
    <div className="vw-shell">
      <Link to="/watch" className="vw-back">
        <ArrowRight className="w-4 h-4" /> العودة للمحتوى
      </Link>

      {/* منصّة المشغّل */}
      <div className="vw-stage">
        <div className="vw-player" ref={playerRef}>
          {canPlay && playbackUrl ? (
            isVod ? (
              <video src={playbackUrl} controls autoPlay style={{ maxHeight: '74vh' }}>
                <track kind="captions" />
              </video>
            ) : (
              <HlsPlayer
                key={reloadKey}
                src={playbackUrl}
                onDemand={isOnDemand}
                starting={streamStarting}
              />
            )
          ) : (
            <div className="vw-player-empty">
              <div className="text-center">
                <Tv2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 font-medium">
                  {isStarting
                    ? 'جاري تشغيل القناة على سيرفر البث — لحظات...'
                    : channel.status === 'running'
                      ? 'جاري تجهيز البث...'
                      : isOnDemand
                        ? 'اضغط إعادة الاتصال لتشغيل القناة'
                        : 'القناة غير نشطة حالياً'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* بطاقة معلومات القناة */}
      <div className="vw-info">
        <div className="vw-avatar">
          {image ? (
            <img src={image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          ) : (
            isVod ? <Film className="w-7 h-7 text-slate-600" /> : <Tv2 className="w-7 h-7 text-slate-600" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="vw-title truncate">{channel.name}</h1>

          <div className="flex items-center gap-2 flex-wrap mt-2">
            {isVod ? (
              <span className="vw-live" style={{ background: '#7c3aed' }}>فيلم</span>
            ) : isOnDemand ? (
              <span className="vw-chip">On Demand</span>
            ) : channel.status === 'running' ? (
              <span className="vw-live"><span className="dot" /> LIVE</span>
            ) : null}
            {channel.category_name && (
              <span className="vw-chip"><Layers className="w-3.5 h-3.5" /> {channel.category_name}</span>
            )}
          </div>

          {channel.description && <p className="vw-desc">{channel.description}</p>}

          <div className="vw-actions">
            <button type="button" className="vw-action" onClick={handleShare}>
              <Share2 className="w-4 h-4" /> مشاركة
            </button>
            {canPlay && playbackUrl && (
              <button type="button" className="vw-action" onClick={handleFullscreen}>
                <Maximize className="w-4 h-4" /> ملء الشاشة
              </button>
            )}
            {!isVod && canPlay && playbackUrl && (
              <button type="button" className="vw-action" onClick={handleReload}>
                <RotateCw className="w-4 h-4" /> إعادة الاتصال
              </button>
            )}
          </div>

          {toast && <div className="vw-toast">{toast}</div>}
        </div>
      </div>

      <div className="viewer-expiry-banner ok mt-3 text-sm flex items-center justify-center gap-2">
        <ShieldCheck className="w-4 h-4" />
        {isVod ? branding.vod_watch_notice : branding.live_watch_notice}
      </div>

      {/* قنوات ذات صلة */}
      {related.length > 0 && (
        <section>
          <h2 className="vw-section-title"><Tv2 className="w-4 h-4 text-teal-400" /> شاهد أيضاً</h2>
          <div className="viewer-row-scroll">
            {related.map((c) => <RelatedCard key={c.id} channel={c} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function RelatedCard({ channel }) {
  const isVod = channel.content_type === 'vod';
  const canWatch = isVod || channel.on_demand || channel.status === 'running';
  const image = proxiedImageUrl(channel.logo_url || channel.poster_url);

  const inner = (
    <div className={`viewer-channel-card ${canWatch ? 'cursor-pointer' : 'opacity-60'}`}>
      <div className="viewer-channel-thumb">
        {image ? (
          <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ) : null}
        {!isVod && (channel.on_demand || channel.status === 'running') && (
          <span className="viewer-live-badge">
            {channel.on_demand && channel.status !== 'running'
              ? 'OD'
              : <><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE</>}
          </span>
        )}
        {isVod && <span className="viewer-live-badge bg-violet-600/90">فيلم</span>}
        {canWatch ? (
          <div className="viewer-play-btn"><Play className="w-5 h-5 text-teal-300 mr-[-2px]" fill="currentColor" /></div>
        ) : (
          !image && <Tv2 className="w-9 h-9 text-slate-600" />
        )}
      </div>
      <div className="viewer-channel-body">
        <h3 className="font-bold text-white truncate text-sm">{channel.name}</h3>
      </div>
    </div>
  );

  return canWatch ? <Link to={`/watch/live/${channel.id}`}>{inner}</Link> : inner;
}
