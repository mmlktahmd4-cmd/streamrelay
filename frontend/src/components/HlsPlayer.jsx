import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

export default function HlsPlayer({ src, autoPlay = true, onDemand = false, starting = false }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(!!starting);

  useEffect(() => {
    setWaiting(!!starting);
  }, [starting, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setError('');
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
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        manifestLoadingMaxRetry: 20,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 16,
        fragLoadingMaxRetry: 20,
        fragLoadingRetryDelay: 1000,
      });

      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        fatalRetries = 0;
        mediaErrorCount = 0;
        setWaiting(false);
        if (autoPlay) video.play().catch(() => {});
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

  return (
    <div className="relative w-full bg-black aspect-video">
      <video ref={videoRef} controls className="w-full h-full" playsInline />
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
