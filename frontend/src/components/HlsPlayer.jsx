import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

export default function HlsPlayer({ src, autoPlay = true }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setError('');
    let hls;
    let retryTimer;

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        liveSyncDurationCount: 3,
        manifestLoadingMaxRetry: 8,
        fragLoadingMaxRetry: 8,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          retryTimer = setTimeout(() => hls?.startLoad(), 2000);
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        setError('تعذّر تشغيل البث — أعد تشغيل القناة');
        hls.destroy();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      if (autoPlay) video.play().catch(() => {});
    } else {
      setError('المتصفح لا يدعم HLS');
    }

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (hls) hls.destroy();
    };
  }, [src, autoPlay]);

  return (
    <div className="relative w-full bg-black aspect-video">
      <video ref={videoRef} controls className="w-full h-full" playsInline />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-red-300 text-sm px-4 text-center">
          {error}
        </div>
      )}
    </div>
  );
}
