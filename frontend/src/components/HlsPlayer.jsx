import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Maximize, Minimize } from 'lucide-react';

function levelLabel(level) {
  if (!level) return '';
  if (level.height) return `${level.height}p`;
  if (level.bitrate) return `${Math.round(level.bitrate / 1000)}k`;
  return 'تلقائي';
}

/** H.264/AVC — الوحيد المدعوم بشكل موثوق في متصفحات سطح المكتب عبر MSE */
function isBrowserH264Level(level) {
  const codec = String(level?.videoCodec || level?.attrs?.CODECS || '');
  if (!codec) return true;
  return /avc1|avc3|h264/i.test(codec);
}

function pickBrowserFriendlyLevel(levels) {
  if (!Array.isArray(levels) || !levels.length) return -1;
  for (let i = levels.length - 1; i >= 0; i -= 1) {
    if (isBrowserH264Level(levels[i])) return i;
  }
  return levels.length === 1 ? 0 : -1;
}

export default function HlsPlayer({ src, autoPlay = true, onDemand = false, starting = false }) {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(!!starting);
  const [levels, setLevels] = useState([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [autoMode, setAutoMode] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // الدقّة الفعلية المُشغّلة (تُقرأ من عنصر الفيديو — تتغيّر لحظياً مع تبديل ABR)
  const [playingHeight, setPlayingHeight] = useState(0);

  const selectLevel = (index) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = index; // -1 = تلقائي
    setAutoMode(index === -1);
  };

  // ملء الشاشة على الحاوية كاملة (وليس عنصر الفيديو وحده) حتى يبقى شريط اختيار
  // الجودة ظاهراً للمشترك أثناء المشاهدة بملء الشاشة.
  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    } else {
      // iOS Safari لا يدعم ملء شاشة الحاوية — نرجع لعنصر الفيديو
      videoRef.current?.webkitEnterFullscreen?.();
    }
  };

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  useEffect(() => {
    setWaiting(!!starting);
  }, [starting, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setError('');
    setLevels([]);
    setCurrentLevel(-1);
    setAutoMode(true);
    setPlayingHeight(0);

    const updatePlayingRes = () => {
      if (video.videoHeight > 0) setPlayingHeight(video.videoHeight);
    };
    // 'resize' يُطلَق عند تغيّر دقّة الفيديو فعلياً (أي عند تبديل جودة ABR)
    video.addEventListener('resize', updatePlayingRes);
    video.addEventListener('loadedmetadata', updatePlayingRes);
    video.addEventListener('playing', updatePlayingRes);

    let retryTimer = null;
    let fatalRetries = 0;
    let mediaErrorCount = 0;
    let destroyed = false;
    const maxFatalRetries = onDemand ? 30 : 25;

    function destroyHls() {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    }

    function initHls() {
      if (destroyed) return;
      destroyHls();

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        liveDurationInfinity: true,
        // مخزن مؤقت أكبر يمتص تذبذب نت المشتركين البعيدين (سلوك شبيه بيوتيوب):
        // يراكم المشغّل ثوانيَ أكثر مقدّماً فيتحمّل انقطاعات لحظية دون تجمّد.
        backBufferLength: 30,
        maxBufferLength: 60,
        maxMaxBufferLength: 180,
        // نسمح بمخزن حتى 120 ميجابايت قبل التوقف عن التحميل (للنت السريع المتذبذب)
        maxBufferSize: 120 * 1000 * 1000,
        // فجوات صغيرة في البث لا توقف التشغيل — يقفز فوقها بدل التجمّد
        maxBufferHole: 0.5,
        // نافذة تأخير أوسع للبث المباشر: نسمح للمشترك البطيء أن يتأخر كثيراً عن الحافة
        // قبل أن يُجبر على القفز للحظة الحية (القفز هو ما يُحدث «التقطيع» المرئي).
        liveSyncDurationCount: 4,
        liveMaxLatencyDurationCount: 20,
        // تقدير سرعة النت: بدء بقيمة محافِظة ثم تكيّف — يمنع اختناق البداية للبعيدين
        abrEwmaDefaultEstimate: 800000,
        // محاولات أكثر وأطول قبل الاستسلام (تنفع الشبكات الضعيفة/المتقطعة)
        manifestLoadingMaxRetry: 20,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 16,
        fragLoadingMaxRetry: 30,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 64000,
        // تجاوُز التعثّر التلقائي: يدفع رأس التشغيل عند الفجوات بدل التجمّد
        nudgeMaxRetry: 10,
        nudgeOffset: 0.2,
        maxStarvationDelay: 8,
      });

      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        fatalRetries = 0;
        mediaErrorCount = 0;
        setWaiting(false);
        const manifestLevels = data?.levels || hls.levels || [];
        setLevels(manifestLevels.map((l) => ({ height: l.height, bitrate: l.bitrate })));
        setAutoMode(hls.autoLevelEnabled);

        // تجنّب اختيار جودة HEVC/MPEG-2 في ABR (صوت فقط بدون صورة في Chrome/Firefox)
        const startIdx = pickBrowserFriendlyLevel(manifestLevels);
        if (startIdx >= 0 && !isBrowserH264Level(manifestLevels[manifestLevels.length - 1])) {
          hls.startLevel = startIdx;
          hls.nextLevel = startIdx;
          setCurrentLevel(startIdx);
          setAutoMode(false);
        }

        if (autoPlay) video.play().catch(() => {});
      });

      // تتبّع الجودة المُشغّلة فعلياً (ترتفع/تنخفض تلقائياً حسب سرعة النت)
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        if (typeof data?.level === 'number') setCurrentLevel(data.level);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (destroyed || !data.fatal) return;

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          mediaErrorCount += 1;
          if (mediaErrorCount === 1) {
            hls.recoverMediaError();
          } else if (mediaErrorCount === 2) {
            hls.swapAudioCodec();
            hls.recoverMediaError();
          } else {
            // إعادة بناء المشغّل بالكامل
            mediaErrorCount = 0;
            setWaiting(true);
            retryTimer = setTimeout(initHls, 3000);
          }
          return;
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR || (onDemand && fatalRetries < maxFatalRetries)) {
          fatalRetries += 1;
          setWaiting(true);
          // كل 12 محاولة: إعادة بناء HLS بدلاً من startLoad فقط
          if (fatalRetries % 12 === 0) {
            retryTimer = setTimeout(initHls, onDemand ? 2000 : 3000);
          } else {
            retryTimer = setTimeout(() => hlsRef.current?.startLoad(), onDemand ? 1500 : 2000);
          }
          return;
        }

        setWaiting(false);
        setError(onDemand ? 'جاري تشغيل القناة — انتظر أو أعد المحاولة' : 'تعذّر تشغيل البث — أعد تشغيل القناة');
        destroyHls();
      });
    }

    if (Hls.isSupported()) {
      initHls();
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.onloadedmetadata = () => setWaiting(false);
      if (autoPlay) video.play().catch(() => {});
    } else {
      setError('المتصفح لا يدعم HLS');
    }

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      video.removeEventListener('resize', updatePlayingRes);
      video.removeEventListener('loadedmetadata', updatePlayingRes);
      video.removeEventListener('playing', updatePlayingRes);
      destroyHls();
    };
  }, [src, autoPlay, onDemand]);

  // الجودة المعروضة: نفضّل الدقّة الفعلية من الفيديو، وإلا من بيانات القائمة
  const qualityText = playingHeight > 0
    ? `${playingHeight}p`
    : (currentLevel >= 0 && levels[currentLevel] ? levelLabel(levels[currentLevel]) : '—');

  return (
    <div ref={rootRef} className={isFullscreen ? 'w-full h-full flex flex-col bg-black' : 'w-full'}>
      <div className={isFullscreen ? 'relative flex-1 min-h-0 bg-black' : 'relative w-full bg-black aspect-video min-h-[12rem]'}>
        <video ref={videoRef} controls className="absolute inset-0 w-full h-full object-contain bg-black" playsInline />

        {waiting && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75 text-slate-200 text-sm px-4 text-center">
            {onDemand ? 'جاري تشغيل القناة على سيرفر البث...' : 'جاري تحميل البث...'}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-red-300 text-sm px-4 text-center">
            {error}
          </div>
        )}
      </div>

      {/* شريط الجودة أسفل المشغّل — لا يأكل من مساحة الفيديو، ويبقى ظاهراً في ملء الشاشة */}
      <div className={`flex items-center justify-between gap-3 bg-slate-900 px-3 py-2 text-xs text-slate-200 flex-wrap ${isFullscreen ? 'shrink-0' : 'rounded-b-lg'}`}>
        <div className="flex items-center gap-2">
          <span className="text-slate-400">الجودة الحالية:</span>
          <span className="font-bold text-teal-400">{qualityText}</span>
          {levels.length > 1 && (
            <span className="text-slate-500">{autoMode ? '(تلقائي)' : '(يدوي)'}</span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {levels.length > 1 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-slate-400 ml-1">اختر الجودة:</span>
              <button
                type="button"
                onClick={() => selectLevel(-1)}
                className={`rounded px-2 py-1 transition-colors ${autoMode ? 'bg-teal-600 text-white font-bold' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}
              >
                تلقائي
              </button>
              {levels.map((lvl, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => selectLevel(i)}
                  className={`rounded px-2 py-1 transition-colors ${!autoMode && currentLevel === i ? 'bg-teal-600 text-white font-bold' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}
                >
                  {levelLabel(lvl)}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'}
            className="flex items-center gap-1 rounded px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
            {isFullscreen ? 'إنهاء' : 'ملء الشاشة'}
          </button>
        </div>
      </div>
    </div>
  );
}
