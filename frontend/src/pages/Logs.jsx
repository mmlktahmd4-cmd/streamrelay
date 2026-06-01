import { useEffect, useState } from 'react';
import { getLogs } from '../api/client';
import LoadingSpinner from '../components/ui/LoadingSpinner';

const levelStyles = {
  debug: 'text-slate-400',
  info: 'text-blue-600',
  warn: 'text-amber-600',
  error: 'text-red-600',
};

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState('');

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data } = await getLogs({ limit: 100, level: level || undefined });
        setLogs(data);
      } catch { /* ignore */ }
      setLoading(false);
    };
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, [level]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">سجلات البث</h1>
          <p className="page-subtitle">مراقبة أحداث القنوات والأخطاء</p>
        </div>
        <select className="input w-auto" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">جميع المستويات</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
      </div>

      {loading ? (
        <LoadingSpinner className="py-24" />
      ) : logs.length === 0 ? (
        <div className="card text-center py-12 text-slate-400">لا توجد سجلات</div>
      ) : (
        <div className="admin-table-wrap">
          <div className="max-h-[70vh] overflow-y-auto font-mono text-xs">
            {logs.map((log) => (
              <div key={log.id} className="flex gap-3 px-4 py-2.5 border-b border-slate-100 hover:bg-slate-50">
                <span className="text-slate-400 whitespace-nowrap">{new Date(log.created_at).toLocaleString('ar')}</span>
                <span className={`uppercase w-12 font-bold ${levelStyles[log.level]}`}>{log.level}</span>
                <span className="text-slate-500 w-32 truncate">{log.channel_name || '-'}</span>
                <span className="text-slate-700 flex-1">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
