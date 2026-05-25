export default function StatusBadge({ status }) {
  const map = {
    running: { class: 'badge-running', label: 'يعمل' },
    stopped: { class: 'badge-stopped', label: 'متوقف' },
    starting: { class: 'badge-starting', label: 'جاري التشغيل' },
    restarting: { class: 'badge-starting', label: 'إعادة تشغيل' },
    error: { class: 'badge-error', label: 'خطأ' },
  };

  const { class: cls, label } = map[status] || map.stopped;

  return <span className={cls}>{label}</span>;
}
