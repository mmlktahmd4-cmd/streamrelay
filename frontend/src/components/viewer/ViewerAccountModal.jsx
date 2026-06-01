import { useEffect, useState } from 'react';
import { getMe } from '../../api/client';
import { X, User, Calendar, Clock, Wifi, Shield } from 'lucide-react';

function daysRemaining(expiresAt) {
  if (!expiresAt) return null;
  return Math.ceil((new Date(expiresAt) - new Date()) / 86400000);
}

export default function ViewerAccountModal({ open, onClose }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getMe()
      .then(({ data }) => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const days = daysRemaining(profile?.expires_at);
  const expired = days !== null && days < 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="viewer-modal w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <User className="w-5 h-5 text-teal-400" /> معلومات الحساب
          </h2>
          <button type="button" onClick={onClose} className="viewer-icon-btn">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <p className="text-gray-400 text-center py-8">جاري التحميل...</p>
        ) : profile ? (
          <div className="space-y-3">
            <Row icon={User} label="اسم المستخدم" value={profile.username} mono />
            <Row icon={Shield} label="نوع الحساب" value="مشاهد" />
            {profile.expires_at ? (
              <>
                <Row icon={Calendar} label="تاريخ الانتهاء" value={new Date(profile.expires_at).toLocaleString('ar')} />
                <div className={`viewer-expiry-banner ${expired ? 'expired' : days <= 7 ? 'warning' : 'ok'}`}>
                  {expired
                    ? 'انتهت صلاحية حسابك — تواصل مع المسؤول للتجديد'
                    : `متبقي ${days} يوم على انتهاء الاشتراك`}
                </div>
              </>
            ) : (
              <Row icon={Calendar} label="تاريخ الانتهاء" value="غير محدد" />
            )}
            <Row icon={Wifi} label="الاتصالات المسموحة" value={String(profile.max_connections || 1)} />
            <Row icon={Clock} label="آخر دخول" value={profile.last_login ? new Date(profile.last_login).toLocaleString('ar') : '—'} />
          </div>
        ) : (
          <p className="text-red-400 text-center py-6">تعذّر تحميل بيانات الحساب</p>
        )}
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value, mono = false }) {
  return (
    <div className="viewer-info-row">
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <Icon className="w-4 h-4 shrink-0" />
        {label}
      </div>
      <div className={`text-white font-semibold text-sm ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}
