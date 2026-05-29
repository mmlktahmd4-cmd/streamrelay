import { useEffect, useState, useCallback } from 'react';
import { getPlaybackUrl } from '../../api/client';
import { copyText } from '../../utils/clipboard';
import { Copy, Check, Link2, Loader2 } from 'lucide-react';

export default function RelayUrlCopy({ channelId, status, autoLoad = true, compact = false }) {
  const [url, setUrl] = useState('');
  const [streamServer, setStreamServer] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const loadUrl = useCallback(async () => {
    if (status !== 'running' || !channelId) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await getPlaybackUrl(channelId);
      if (data?.url) setUrl(data.url);
      setStreamServer(data?.stream_server_hostname || data?.stream_server || '');
      else setError('لم يُرجَع رابط');
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر جلب الرابط');
    } finally {
      setLoading(false);
    }
  }, [channelId, status]);

  useEffect(() => {
    if (!autoLoad || status !== 'running') {
      setUrl('');
      setError('');
      return;
    }
    loadUrl();
  }, [autoLoad, status, channelId, loadUrl]);

  const copyUrl = async (e) => {
    e?.preventDefault();
    e?.stopPropagation();

    let target = url;
    if (!target) {
      setLoading(true);
      setError('');
      try {
        const { data } = await getPlaybackUrl(channelId);
        target = data?.url;
        if (target) setUrl(target);
        else {
          setError('لم يُرجَع رابط');
          setLoading(false);
          return;
        }
      } catch (err) {
        setError(err.response?.data?.error || 'تعذّر جلب الرابط');
        setLoading(false);
        return;
      }
      setLoading(false);
    }

    const ok = await copyText(target);
    if (ok) {
      setCopied(true);
      setError('');
      setTimeout(() => setCopied(false), 2000);
    } else {
      setError('تعذّر النسخ — حدّد الرابط وانسخه يدوياً (Ctrl+C)');
    }
  };

  if (status !== 'running') {
    return compact ? null : (
      <span className="text-xs text-slate-500">شغّل القناة للحصول على رابط البث الداخلي</span>
    );
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={copyUrl}
        disabled={loading}
        className="btn-icon !p-1.5"
        title={error || 'نسخ رابط البث الداخلي'}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Link2 className="w-3.5 h-3.5" />}
      </button>
    );
  }

  return (
    <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
      <div className="relay-url-box">
        {loading && !url ? (
          <span className="text-[10px] text-slate-500 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> جاري التحميل...
          </span>
        ) : error && !url ? (
          <button type="button" onClick={loadUrl} className="text-[10px] text-red-600 hover:underline">
            {error} — إعادة
          </button>
        ) : (
            <>
            <code
              dir="ltr"
              className="relay-url-text"
              title={url}
              onClick={(e) => {
                e.stopPropagation();
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(e.currentTarget);
                sel?.removeAllRanges();
                sel?.addRange(range);
              }}
            >
              {url || '...'}
            </code>
            <button
              type="button"
              onClick={copyUrl}
              disabled={loading}
              className="shrink-0 p-1 rounded text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              title="نسخ الرابط"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            </button>
          </>
        )}
      </div>
      {error && url && (
        <p className="text-[10px] text-amber-700">{error}</p>
      )}
      {streamServer && (
        <p className="text-[10px] text-slate-500">سيرفر البث: <span className="font-mono font-semibold">{streamServer}</span></p>
      )}
      {copied && (
        <p className="text-[10px] text-emerald-600">تم نسخ الرابط</p>
      )}
    </div>
  );
}
