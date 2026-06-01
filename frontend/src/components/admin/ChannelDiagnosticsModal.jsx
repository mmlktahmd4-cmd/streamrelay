import { useState } from 'react';
import LoadingSpinner from '../ui/LoadingSpinner';
import { AlertCircle, CheckCircle2, Stethoscope, Wrench, X } from 'lucide-react';

function CheckRow({ label, ok, detail }) {
  return (
    <div className="flex items-start gap-2 text-sm py-1.5 border-b border-slate-50 last:border-0">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
      )}
      <div>
        <span className="font-medium text-slate-700">{label}</span>
        {detail && <p className="text-slate-500 text-xs mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

function ResultCard({ item, onFix, fixing }) {
  const [expanded, setExpanded] = useState(!item.ok);
  const checks = item.checks || {};

  return (
    <div className={`rounded-lg border p-3 ${item.ok ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/30'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-800">{item.name || item.channel_id}</p>
          <p className="text-xs text-slate-500">{item.server_name || '—'} · {item.status}</p>
          <p className={`text-sm mt-1 ${item.ok ? 'text-emerald-700' : 'text-red-700'}`}>{item.summary}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          {!item.ok && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={fixing}
              onClick={() => onFix(item.channel_id)}
            >
              <Wrench className="w-3.5 h-3.5" /> إصلاح
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'إخفاء' : 'تفاصيل'}
          </button>
        </div>
      </div>

      {expanded && checks.source && (
        <div className="mt-3 pt-3 border-t border-slate-200/80 space-y-0">
          <CheckRow
            label="المصدر"
            ok={checks.source.ok || checks.source.skipped}
            detail={checks.source.error || checks.source.note || (checks.source.latency_ms != null ? `${checks.source.latency_ms}ms` : null)}
          />
          {checks.worker && (
            <CheckRow
              label={`السيرفر (${checks.worker.name})`}
              ok={checks.worker.online && !checks.worker.suspended}
              detail={checks.worker.online ? `متصل · ${checks.worker.load}` : 'غير متصل — حدّث السيرفر'}
            />
          )}
          {checks.hls && (
            <CheckRow
              label="بث HLS"
              ok={checks.hls.ok}
              detail={checks.hls.error || checks.hls.url || checks.hls.path}
            />
          )}
          {checks.process && (
            <CheckRow
              label="FFmpeg"
              ok={checks.process.ok !== false}
              detail={checks.process.note || (checks.process.pid ? `PID ${checks.process.pid}` : null)}
            />
          )}
          {item.last_error && (
            <p className="text-xs text-red-600 mt-2 bg-white/60 rounded p-2">{item.last_error}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChannelDiagnosticsModal({ open, onClose, results, loading, onRunFix, onRunFixAll, fixingId }) {
  if (!open) return null;

  const failed = results?.channels?.filter((c) => !c.ok) || [];
  const fixable = failed.filter((c) => c.issues?.some((i) => i.fix === 'restart'));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-blue-600" />
            <h2 className="font-bold text-lg">نتائج فحص القنوات</h2>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="إغلاق">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {loading ? (
            <LoadingSpinner className="py-12" />
          ) : results ? (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="admin-tag">{results.total} قناة</span>
                <span className="admin-tag admin-tag-green">{results.ok} سليمة</span>
                <span className="admin-tag text-red-700 bg-red-50">{results.failed} بها مشاكل</span>
              </div>

              {results.channels?.length === 0 && (
                <p className="text-slate-500 text-center py-8">لا توجد نتائج</p>
              )}

              {results.channels?.map((item) => (
                <ResultCard
                  key={item.channel_id}
                  item={item}
                  onFix={onRunFix}
                  fixing={fixingId === item.channel_id}
                />
              ))}
            </>
          ) : (
            <p className="text-slate-500 text-center py-8">اضغط «فحص» لبدء التشخيص</p>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 flex flex-wrap gap-2 justify-end">
          {fixable.length > 0 && (
            <button type="button" className="btn btn-primary btn-sm" disabled={!!fixingId} onClick={onRunFixAll}>
              <Wrench className="w-3.5 h-3.5" /> إصلاح {fixable.length} قناة
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  );
}
