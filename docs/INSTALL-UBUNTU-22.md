# StreamRelay — دليل التثبيت على Ubuntu 22.04

> يعمل أيضاً على Ubuntu **24.04** بنفس الخطوات.

---

## 1) المتطلبات

| البند | الحد الأدنى |
|--------|-------------|
| النظام | Ubuntu **22.04 LTS** (64-bit) |
| RAM | 4 GB (8 GB للبث) |
| القرص | 20 GB |
| الشبكة | منفذ **80** أو **8080** |

**تحقق من الإصدار:**

```bash
lsb_release -a
# يجب: Ubuntu 22.04.x LTS
```

---

## 2) التثبيت السهل (موصى به)

**أمر واحد:**

```bash
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/easy-install.sh | sudo bash
```

**أو clone + تثبيت:**

```bash
sudo apt update
sudo apt install -y git curl
sudo git clone https://github.com/mmlktahmd4-cmd/streamrelay.git /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

**بديل (install-from-github):**

```bash
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/install-from-github.sh \
  | sudo bash -s -- https://github.com/mmlktahmd4-cmd/streamrelay.git
```

---

## 3) ماذا يفعل سكربت التثبيت؟

| الخطوة | ماذا يحدث |
|--------|-----------|
| `[1/7]` | تثبيت **Docker** و Docker Compose |
| `[2/7]` | نسخ المشروع إلى `/opt/streamrelay` |
| `[3/7]` | إنشاء ملف **`.env`** |
| `[4/7]` | بناء **frontend** (لوحة التحكم) |
| `[5/7]` | بناء وتشغيل الحاويات (5–15 دقيقة) |
| `[6/7]` | انتظار جاهزية API |
| `[7/7]` | تفعيل **systemd** للتشغيل التلقائي |

**مهم — تشغيل السكربتات:**

```bash
# ✅ صح — استخدم دائماً bash
sudo bash scripts/ubuntu-quick-install.sh

# ❌ خطأ — قد يظهر Permission denied بعد git clone
sudo scripts/ubuntu-quick-install.sh
sudo ./scripts/install-ubuntu22.sh
```

**إذا ظهر `Permission denied`:**

```bash
cd /opt/streamrelay
chmod +x scripts/*.sh
sudo bash scripts/ubuntu-quick-install.sh
```

1. يثبّت **Docker** و **Docker Compose** (إن لم يكونا موجودين)
2. ينشئ ملف **`.env`** بكلمات سر عشوائية
3. يكتشف إذا **منفذ 80 مشغول** (Apache/Nginx) → يستخدم **8080** تلقائياً
4. يبني ويشغّل الحاويات: `postgres`, `redis`, `api`, `worker`, `frontend`, `nginx`
5. يفعّل **systemd** للتشغيل التلقائي بعد إعادة تشغيل السيرفر

---

## 4) بعد التثبيت

```bash
cat /opt/streamrelay/INSTALL-CREDENTIALS.txt
docker compose ps
```

| الخدمة | الرابط |
|--------|--------|
| لوحة الإدارة | `http://IP/login` أو `http://IP:8080/login` |
| بوابة المشاهدة | `http://IP/watch/login` |
| API | `http://IP/api/health` |

- **المستخدم:** `admin`
- **كلمة المرور:** في `INSTALL-CREDENTIALS.txt`

---

## 5) سيرفر فيه موقع آخر (Apache / ibda.shop)

لا توقف Apache. السكript يضبط تلقائياً:

```env
STREAMRELAY_HTTP_PORT=8080
PUBLIC_BASE_URL=http://YOUR-IP:8080
```

افتح: **`http://IP-SERVER:8080/login`**

---

## 6) التثبيت بدون Git (حزمة tar)

### على Windows

```powershell
cd Desktop\iptv
powershell -ExecutionPolicy Bypass -File scripts\pack-for-transfer.ps1
```

### انقل الملف

```powershell
scp streamrelay-ubuntu.tar.gz root@IP-SERVER:/tmp/
```

### على Ubuntu 22

```bash
sudo mkdir -p /opt/streamrelay
sudo tar -xzf /tmp/streamrelay-ubuntu.tar.gz -C /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

---

## 7) الجدار الناري (UFW)

```bash
# إذا StreamRelay على 80
sudo ufw allow 80/tcp

# إذا على 8080
sudo ufw allow 8080/tcp

sudo ufw reload
sudo ufw status
```

---

## 8) التحديث

```bash
cd /opt/streamrelay
sudo bash scripts/update-from-github.sh
```

---

## 9) أوامر يومية

```bash
cd /opt/streamrelay

docker compose ps                 # الحالة
docker compose logs -f api        # سجل API
docker compose logs -f nginx      # سجل Nginx
docker compose restart            # إعادة تشغيل
sudo systemctl status streamrelay # خدمة systemd
```

---

## 10) استكشاف الأخطاء

### git pull — dubious ownership

```bash
sudo git config --global --add safe.directory /opt/streamrelay
cd /opt/streamrelay
git pull
```

### yaml: mapping values are not allowed (docker-compose.yml)

```bash
cd /opt/streamrelay
sudo git pull
# أو إصلاح يدوي:
python3 -c "from pathlib import Path; p=Path('docker-compose.yml'); p.write_text(p.read_text().replace('services:  postgres:','services:\n\n  postgres:',1))"
docker compose config
sudo bash scripts/ubuntu-quick-install.sh
```

### Permission denied على السكربت

```bash
cd /opt/streamrelay
chmod +x scripts/*.sh
sudo bash scripts/ubuntu-quick-install.sh
```

> بعد `git clone` بعض الأنظمة لا تعطي صلاحية تنفيذ — استخدم **`bash scripts/...`** دائماً.

### منفذ مشغول

```bash
sudo bash scripts/check-ports.sh
```

### Invalid credentials عند تسجيل الدخول

يحدث عندما **كلمة المرور في `.env` لا تطابق** ما في قاعدة البيانات (مثلاً بعد إعادة تثبيت مع الاحتفاظ ببيانات PostgreSQL القديمة).

```bash
sudo cat /opt/streamrelay/INSTALL-CREDENTIALS.txt   # كلمة المرور الصحيحة
sudo bash /opt/streamrelay/scripts/reset-admin-password.sh
```

> لا تستخدم `admin123` — هذه قيمة افتراضية للتطوير فقط. كلمة المرور الفعلية تُنشأ عند التثبيت وتُحفظ في `INSTALL-CREDENTIALS.txt`.

### worker يظهر unhealthy (تحذير فقط)

الـ worker لا يشغّل HTTP API — HEALTHCHECK الافتراضي في Dockerfile يفحص `/api/health` ويفشل رغم أن العامل يعمل.

```bash
docker compose logs worker --tail 20   # يجب أن ترى "Worker ready, processing jobs"
sudo bash scripts/update-from-github.sh
docker compose up -d --force-recreate worker
```

### Nginx يعيد التشغيل (Restarting)

```bash
docker logs sr-nginx --tail 30
cd /opt/streamrelay && git pull
docker compose up -d --force-recreate nginx
```

### API غير healthy

```bash
docker compose logs api --tail 50
curl -s http://127.0.0.1/api/health
# داخل الحاوية:
docker compose exec api wget -qO- http://127.0.0.1:3000/api/health
```

### إعادة بناء كامل

```bash
cd /opt/streamrelay
docker compose down
docker compose build --no-cache
docker compose up -d
```

### إزالة التثبيت

```bash
sudo systemctl disable --now streamrelay
cd /opt/streamrelay
docker compose down -v
sudo rm -rf /opt/streamrelay
```

---

## 11) MikroTik

1. لوحة الإدارة → **MikroTik**
2. IP السيرفر = IP جهاز Ubuntu
3. انسخ السكربت → Terminal في MikroTik
4. العملاء: `http://IP/watch/login` (أو `:8080` إن لزم)

---

## 12) ملفات مهمة

| الملف | الوظيفة |
|-------|---------|
| `scripts/easy-install.sh` | **التثبيت السهل** — أمر واحد |
| `scripts/ubuntu-quick-install.sh` | التثبيت الرئيسي |
| `scripts/install-from-github.sh` | clone + تثبيت |
| `scripts/update-from-github.sh` | تحديث من GitHub |
| `scripts/deploy-update.sh` | بناء frontend + restart |
| `scripts/launch-production.sh` | إطلاق إنتاج |
| `scripts/fix-server-ip.sh` | تصحيح IP الشبكة |
| `scripts/check-ports.sh` | فحص المنافذ |
| `.env` | إعدادات وكلمات السر |
| `INSTALL-CREDENTIALS.txt` | بيانات الدخول |

---

## روابط

- [INSTALL-UBUNTU.md](../INSTALL-UBUNTU.md) — ملخص عام
- [INSTALL-GITHUB.md](../INSTALL-GITHUB.md) — GitHub
- [README.md](../README.md) — نظرة عامة
