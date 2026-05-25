const FALLBACK_MESSAGES = {
  admin: 'فشل تسجيل الدخول — تحقق من بيانات الحساب أو حالة السيرفر',
  viewer: 'فشل تسجيل الدخول — تحقق من اسم المستخدم وكلمة المرور',
};

const REASON_HINTS = {
  admin: {
    wrong_password: 'نصيحة: كلمة مرور المدير محفوظة في INSTALL-CREDENTIALS.txt على السيرفر.',
  },
  viewer: {},
};

export function getAuthErrorMessage(err, context = 'admin') {
  const data = err?.response?.data;
  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error;
  }

  const status = err?.response?.status;
  if (status === 429) return 'محاولات دخول كثيرة — انتظر دقيقة ثم حاول مجدداً';
  if (status === 400) return 'يرجى إدخال اسم المستخدم وكلمة المرور';
  if (!err?.response) return 'تعذر الاتصال بالسيرفر — تحقق من الشبكة أو أن الخدمة تعمل';

  return FALLBACK_MESSAGES[context] || FALLBACK_MESSAGES.admin;
}

export function getAuthErrorHint(err, context = 'admin') {
  const reason = err?.response?.data?.reason;
  return REASON_HINTS[context]?.[reason] || '';
}
