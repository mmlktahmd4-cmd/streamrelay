import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

function levelLabel(level) {
  if (!level) return '';
  if (level.height) return `${level.height}p`;
  if (level.bitrate) return `${Math.round(level.bitrate / 1000)}k`;
  return 'تلقائي';
}

export default function HlsPlayer({ src, autoPlay = true, onDemand = false, starting = false }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(!!starting);
  const [levels, setLevels] = useState([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [autoMode, setAutoMode] = useState(true);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);

  const selectLevel = (index) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = index; // -1 = تلقائي
    setAutoMode(index === -1);
    setQualityMenuOpen(false);
  };

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
    setQualityMenuOpen(false);
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
        setLevels((data?.levels || hls.levels || []).map((l) => ({ height: l.height, bitrate: l.bitrate })));
        setAutoMode(hls.autoLevelEnabled);
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
      destroyHls();
    };
  }, [src, autoPlay, onDemand]);

  const activeLabel = currentLevel >= 0 && levels[currentLevel]
    ? levelLabel(levels[currentLevel])
    : '';
  const badgeText = levels.length
    ? (autoMode ? `تلقائي${activeLabel ? ` · ${activeLabel}` : ''}` : (activeLabel || 'يدوي'))
    : '';

  return (
    <div className="relative w-full bg-black aspect-video">
      <video ref={videoRef} controls className="w-full h-full" playsInline />

      {/* مؤشّر الجودة الحالية + اختيار يدوي — للتأكد أن البث متعدد الجودات يعمل */}
      {levels.length > 0 && (
        <div className="absolute top-2 left-2 z-10">
          <button
            type="button"
            onClick={() => levels.length > 1 && setQualityMenuOpen((v) => !v)}
            className={`flex items-center gap-1 rounded-md bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm ${levels.length > 1 ? 'hover:bg-black/80 cursor-pointer' : 'cursor-default'}`}
            title="الجودة الحالية"
          >
            <span>{badgeText}</span>
            {levels.length > 1 && <span className="text-white/60">▾</span>}
          </button>

          {qualityMenuOpen && levels.length > 1 && (
            <div className="mt-1 min-w-[120px] overflow-hidden rounded-md bg-black/85 backdrop-blur-sm text-white text-xs shadow-lg">
              <button
                type="button"
                onClick={() => selectLevel(-1)}
                className={`block w-full px-3 py-2 text-right hover:bg-white/10 ${autoMode ? 'text-teal-400 font-bold' : ''}`}
              >
                تلقائي{autoMode && activeLabel ? ` (${activeLabel})` : ''}
              </button>
              {levels.map((lvl, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => selectLevel(i)}
                  className={`block w-full px-3 py-2 text-right hover:bg-white/10 ${!autoMode && currentLevel === i ? 'text-teal-400 font-bold' : ''}`}
                >
                  {levelLabel(lvl)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
  );
}
