# StreamRelay — تثبيت على Ubuntu 24.04

## الطريقة الموصى بها — من GitHub

```bash
sudo apt install -y git
sudo git clone https://github.com/mmlktahmd4-cmd/streamrelay.git /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

أو **أمر واحد**:

```bash
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/install-from-github.sh | sudo bash -s -- https://github.com/mmlktahmd4-cmd/streamrelay.git
```

**تحديث لاحقاً:**

```bash
cd /opt/streamrelay && sudo bash scripts/update-from-github.sh
```

> دليل رفع المشروع على GitHub: [INSTALL-GITHUB.md](INSTALL-GITHUB.md)

---

## الطريقة البديلة — حزمة tar (بدون Git)

### 1) على Windows — جهّز حزمة النقل

```powershell
cd Desktop\iptv
powershell -ExecutionPolicy Bypass -File scripts\pack-for-transfer.ps1
```

سيُنشأ ملف: **`streamrelay-ubuntu24.tar.gz`**

> أو على Linux/Mac: `bash scripts/pack-for-transfer.sh`

---

### 2) انقل الملف إلى Ubuntu 24

```bash
# مثال عبر SCP من Windows (PowerShell):
scp streamrelay-ubuntu24.tar.gz user@192.168.1.100:/tmp/
```

---

### 3) على Ubuntu — ثبّت بأمر واحد

```bash
sudo mkdir -p /opt/streamrelay
sudo tar -xzf /tmp/streamrelay-ubuntu24.tar.gz -C /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

انتظر 5–15 دقيقة (أول بناء Docker).

---

## بعد التثبيت

| الخدمة | الرابط |
|--------|--------|
| لوحة الإدارة | `http://IP-SERVER/login` |
| بوابة المشاهدة | `http://IP-SERVER/watch/login` |
| API | `http://IP-SERVER/api/health` |

- **المستخدم الافتراضي:** `admin`
- **كلمة المرور:** تظهر في نهاية التثبيت + ملف `/opt/streamrelay/INSTALL-CREDENTIALS.txt`

---

## أوامر مهمة

```bash
cd /opt/streamrelay

docker compose ps              # حالة الخدمات
docker compose logs -f api     # سجل Backend
docker compose restart         # إعادة تشغيل الكل
docker compose down            # إيقاف
docker compose up -d           # تشغيل
```

---

## MikroTik / الشبكة

1. افتح **MikroTik** في لوحة الإدارة
2. اكتب **IP السيرفر** (مثل `192.168.1.100`)
3. احفظ → انسخ السكربت → الصقه في MikroTik Terminal
4. العملاء يفتحون: `http://IP-SERVER/watch/login`

---

## متطلبات Ubuntu 24

- Ubuntu 24.04 LTS (64-bit)
- 4 GB RAM على الأقل (8 GB أفضل للبث)
- 20 GB مساحة قرص
- منافذ مفتوحة: **80**, **443**, **3000**, **1935** (RTMP اختياري)

---

## استكشاف الأخطاء

```bash
# API لا يعمل
docker compose logs api

# قاعدة البيانات
docker compose logs postgres

# إعادة بناء كامل
docker compose down
docker compose build --no-cache
docker compose up -d
```

---

## تطوير محلي (بدون Docker كامل)

```bash
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL + Redis فقط
cd backend && npm install && npm start
cd frontend && npm install && npm run dev
```
