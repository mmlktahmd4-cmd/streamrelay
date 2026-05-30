# تطبيق StreamRelay للأندرويد (بوابة المشاهدة)

تطبيق أندرويد بسيط يغلّف بوابة المشاهدة (`/watch/login`) داخل WebView، حتى يشاهد
المستخدم القنوات دون فتح المتصفح. عند أول تشغيل يُدخل المستخدم عنوان السيرفر
(IP أو دومين مع المنفذ، مثال: `192.168.5.102:8080`) ويُحفظ تلقائياً، ويمكن تغييره
لاحقاً من قائمة التطبيق ⋮ → «تغيير عنوان السيرفر».

## الميزات
- يفتح مباشرةً على صفحة دخول المشاهدة.
- دعم تشغيل الفيديو HLS وملء الشاشة التلقائي عند تكبير المشغّل.
- يعمل مع شبكات HTTP المحلية (cleartext مسموح).
- زر تحديث + تغيير عنوان السيرفر، وصفحة خطأ ودّية عند انقطاع الاتصال.

## التحويل إلى APK

### الطريقة 1 — تلقائياً عبر GitHub (موصى بها)
كل دفع لمجلد `android-app/` على فرع `main` يشغّل إجراء
`.github/workflows/android.yml` الذي يبني الـ APK ويرفعه في إصدار باسم
`app-latest`. رابط التحميل الثابت:

```
https://github.com/<owner>/<repo>/releases/download/app-latest/StreamRelay.apk
```

أو من تبويب **Actions → آخر تشغيل → Artifacts → StreamRelay-APK**.

### الطريقة 2 — محلياً عبر Android Studio
1. افتح مجلد `android-app` في Android Studio.
2. اتركه ينزّل Gradle/SDK، ثم Build → Build APK(s).
3. الناتج في `app/build/outputs/apk/debug/app-debug.apk`.

### الطريقة 3 — سطر الأوامر
```bash
cd android-app
gradle wrapper --gradle-version 8.7   # مرة واحدة لإنشاء gradlew
./gradlew assembleDebug
```

## الربط مع اللوحة
بعد رفع الـ APK في إصدار `app-latest`، يقوم سكربت التثبيت/التحديث على السيرفر
بتنزيله إلى `public/app/StreamRelay.apk`، وتعرضه اللوحة للتحميل من
صفحة «تطبيق المشاهدة» ومن صفحة دخول المشاهدة عبر `/api/app/download`.
