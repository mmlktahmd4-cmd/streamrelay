# ربط سيرفر بث يدوياً — StreamRelay

دليل خطوة بخطوة لربط **سيرفر بث ثانٍ** (worker) بالسيرفر الرئيسي **بدون** الربط التلقائي من اللوحة.

> **الربط التلقائي:** من لوحة الإدارة → **سيرفرات البث** → **ربط تلقائي (SSH)**  
> **الربط اليدوي:** نفس النتيجة، لكن أنت تنفّذ الأوامر على السيرفر البعيد بنفسك (مفيد للتشخيص أو إذا فشل SSH).

---

## مخطط سريع

```
┌─────────────────────────┐         ┌─────────────────────────┐
│  السيرفر الرئيسي        │         │  سيرفر البث البعيد      │
│  (Master — node-1)       │         │  (Worker — node-2)        │
│                         │         │                         │
│  API + Postgres + Redis │◄────────│  worker + nginx-hls     │
│  + worker محلي          │  5432   │  (بث فقط)               │
│                         │  6379   │                         │
└─────────────────────────┘         └─────────────────────────┘
```

- السيرفر **الرئيسي** يشغّل كل شيء (لوحة، قاعدة بيانات، طابور Redis).
- السيرفر **البعيد** يشغّل **worker** فقط + **nginx** لخدمة ملفات HLS.
- القنوات تُوزَّع تلقائياً أو تُثبَّت على سيرفر محدد من إعدادات القناة.

---

## 1) تجهيز السيرفر الرئيسي (Master)

نفّذ على الجهاز الذي فيه StreamRelay الكامل (`/opt/streamrelay`).

### 1.1 تحديث الكود

```bash
cd /opt/streamrelay
sudo git pull origin main
sudo bash scripts/safe-update.sh
```

### 1.2 ضبط `.env` — IP الشبكة ومنافذ DB/Redis

```bash
sudo nano /opt/streamrelay/.env
```

تأكد من وجود هذه القيم (عدّل IP حسب شبكتك):

```env
SERVER_IP=192.168.5.102
STREAMRELAY_HTTP_PORT=8080
PUBLIC_BASE_URL=http://192.168.5.102:8080

# ضروري لسيرفرات بعيدة — تسمح بالاتصال من الشبكة المحلية
POSTGRES_PUBLISH=0.0.0.0:5432
REDIS_PUBLISH=0.0.0.0:6379
```

> **أمان:** هذه المنافذ مفتوحة على الشبكة المحلية. استخدم firewall (MikroTik/ufw) لتقييد الوصول لـ IP سيرفرات البث فقط.

### 1.3 إعادة تشغيل Postgres و Redis

```bash
cd /opt/streamrelay
docker compose up -d postgres redis
docker compose restart postgres redis api worker
```

### 1.4 تشخيص الجاهزية

```bash
sudo bash scripts/diagnose-provision-master.sh
```

يجب أن ترى:
- `ssh2 OK` (للربط التلقائي فقط)
- `POSTGRES_PUBLISH=0.0.0.0:5432`
- `REDIS_PUBLISH=0.0.0.0:6379`
- منافذ `5432` و `6379` مستمعة

### 1.5 احفظ بيانات الاتصال (للسيرفر البعيد)

```bash
grep -E '^(SERVER_IP|STREAMRELAY_HTTP_PORT|POSTGRES_|REDIS_)' /opt/streamrelay/.env
```

ستحتاج:
| المتغير | مثال |
|---------|------|
| IP الرئيسي | `192.168.5.102` |
| منفذ الويب | `8080` |
| `POSTGRES_PASSWORD` | من `.env` |
| `POSTGRES_USER` | `streamrelay` |
| `POSTGRES_DB` | `streamrelay` |
| `REDIS_PASSWORD` | فارغ أو كلمة من `.env` |

---

## 2) تجهيز السيرفر البعيد (Worker)

نفّذ **على جهاز البث الثاني** (Ubuntu 22/24) كـ **root** أو `sudo`.

### 2.1 فحص الاتصال بالرئيسي

استبدل `192.168.5.102` بـ IP السيرفر الرئيسي:

```bash
nc -zv 192.168.5.102 5432
nc -zv 192.168.5.102 6379
```

إذا فشل → راجع `POSTGRES_PUBLISH` / `REDIS_PUBLISH` و firewall على الرئيسي.

### 2.2 تثبيت Docker (إن لم يكن موجوداً)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable docker
sudo systemctl start docker
sudo apt update && sudo apt install -y git curl
```

### 2.3 استنساخ المشروع من GitHub

```bash
sudo rm -rf /opt/streamrelay
sudo git clone https://github.com/mmlktahmd4-cmd/streamrelay.git /opt/streamrelay
cd /opt/streamrelay
```

### 2.4 اكتشاف IP السيرفر البعيد

```bash
WORKER_IP=$(hostname -I | awk '{print $1}')
echo "Worker IP: $WORKER_IP"
```

### 2.5 إنشاء ملف `.env` للـ worker

استبدل القيم بين `<>`:

```bash
sudo tee /opt/streamrelay/.env <<'EOF'
NODE_ENV=production
API_PORT=3000

# فريد لكل سيرفر بث — node-2, node-3, ...
SERVER_ID=node-2
SERVER_ROLE=stream-only

SERVER_IP=<WORKER_IP>
STREAMRELAY_HTTP_PORT=8080
PUBLIC_BASE_URL=http://<WORKER_IP>:8080
HLS_BASE_URL=http://<WORKER_IP>:8080/hls

# اتصال بالسيرفر الرئيسي
POSTGRES_HOST=<MASTER_IP>
POSTGRES_PORT=5432
POSTGRES_DB=streamrelay
POSTGRES_USER=streamrelay
POSTGRES_PASSWORD=<POSTGRES_PASSWORD_FROM_MASTER>

REDIS_HOST=<MASTER_IP>
REDIS_PORT=6379
REDIS_PASSWORD=<REDIS_PASSWORD_OR_EMPTY>

HLS_OUTPUT_DIR=/var/www/hls
MPEGTS_OUTPUT_DIR=/var/www/mpegts
VOD_DIR=/var/www/vod
MAX_CONCURRENT_STREAMS=100
HEALTH_CHECK_INTERVAL=15
LOG_DIR=/var/log/streamrelay
JWT_SECRET=remote-worker-placeholder
JWT_REFRESH_SECRET=remote-worker-placeholder
EOF
```

**مثال جاهز** (عدّل IP وكلمة المرور):

```bash
MASTER_IP=192.168.5.102
WORKER_IP=192.168.5.105
DB_PASS="انسخ_من_env_الرئيسي"

sudo tee /opt/streamrelay/.env <<EOF
NODE_ENV=production
SERVER_ID=node-2
SERVER_ROLE=stream-only
SERVER_IP=${WORKER_IP}
STREAMRELAY_HTTP_PORT=8080
PUBLIC_BASE_URL=http://${WORKER_IP}:8080
HLS_BASE_URL=http://${WORKER_IP}:8080/hls
POSTGRES_HOST=${MASTER_IP}
POSTGRES_PORT=5432
POSTGRES_DB=streamrelay
POSTGRES_USER=streamrelay
POSTGRES_PASSWORD=${DB_PASS}
REDIS_HOST=${MASTER_IP}
REDIS_PORT=6379
REDIS_PASSWORD=
HLS_OUTPUT_DIR=/var/www/hls
MPEGTS_OUTPUT_DIR=/var/www/mpegts
VOD_DIR=/var/www/vod
MAX_CONCURRENT_STREAMS=100
HEALTH_CHECK_INTERVAL=15
LOG_DIR=/var/log/streamrelay
JWT_SECRET=remote-worker-placeholder
JWT_REFRESH_SECRET=remote-worker-placeholder
EOF
```

### 2.6 بناء وتشغيل stack البعيد فقط

```bash
cd /opt/streamrelay
sudo docker compose -f docker-compose.worker-remote.yml build
sudo docker compose -f docker-compose.worker-remote.yml up -d
```

### 2.7 التحقق

```bash
docker compose -f docker-compose.worker-remote.yml ps
docker compose -f docker-compose.worker-remote.yml logs worker --tail 30
curl -s http://127.0.0.1:8080/nginx-health
```

يجب أن ترى حاويتين: `sr-worker` و `sr-nginx-hls` في حالة **running**.

---

## 3) تسجيل السيرفر في لوحة الإدارة (يدوي)

1. افتح: `http://192.168.5.102:8080/login`
2. **سيرفرات البث** → **إضافة يدوي**
3. املأ:

| الحقل | القيمة |
|-------|--------|
| اسم العرض | `سيرفر 2` |
| Hostname (SERVER_ID) | `node-2` — **يجب أن يطابق** `SERVER_ID` في `.env` البعيد |
| IP السيرفر | IP السيرفر البعيد (مثل `192.168.5.105`) |
| الدور | `بث فقط` |
| حد القنوات | `100` |
| رابط HLS | `http://192.168.5.105:8080/api/hls` |

4. احفظ — خلال ~30 ثانية يجب أن تظهر الحالة **«متصل»** (heartbeat).

---

## 4) ربط قناة بسيرفر محدد

1. **القنوات** → **إضافة قناة** أو تعديل قناة
2. حقل **«سيرفر البث»**:
   - **تلقائي** = أقل حمل
   - أو اختر **سيرفر 2 (node-2)**
3. شغّل القناة — البث يذهب للسيرفر المختار

---

## 5) أوامر صيانة سريعة

### على الرئيسي

```bash
cd /opt/streamrelay
docker compose ps
docker compose logs api --tail 50
sudo bash scripts/diagnose-provision-master.sh
```

### على البعيد (worker)

```bash
cd /opt/streamrelay
docker compose -f docker-compose.worker-remote.yml ps
docker compose -f docker-compose.worker-remote.yml logs worker -f
docker compose -f docker-compose.worker-remote.yml restart worker
```

### تحديث السيرفر البعيد بعد `git pull`

```bash
cd /opt/streamrelay
sudo git pull origin main
sudo docker compose -f docker-compose.worker-remote.yml build worker nginx-hls
sudo docker compose -f docker-compose.worker-remote.yml up -d
```

---

## 6) تشغيل سكربت الربط يدوياً (بديل للوحة)

يمكن تشغيل نفس سكربت الربط التلقائي **مباشرة على السيرفر البعيد** (بعد SSH إليه):

```bash
sudo apt install -y git curl
export MASTER_IP=192.168.5.102
export SERVER_ID=node-2
export WORKER_IP=192.168.5.105
export POSTGRES_PASSWORD="كلمة_مرور_من_env_الرئيسي"
export POSTGRES_USER=streamrelay
export POSTGRES_DB=streamrelay
export REDIS_PASSWORD=
export STREAMRELAY_HTTP_PORT=8080
export GITHUB_REPO=https://github.com/mmlktahmd4-cmd/streamrelay.git
export GITHUB_BRANCH=main

curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/provision-stream-worker.sh \
  | sudo bash
```

> بعد نجاح السكربت، سجّل السيرفر في اللوحة (**إضافة يدوي**) إذا لم يُضف تلقائياً.

---

## 7) حل مشاكل شائعة

| المشكلة | الحل |
|---------|------|
| Worker **غير متصل** في اللوحة | تأكد `SERVER_ID` في `.env` = `hostname` في اللوحة |
| `connection refused` Postgres | `POSTGRES_PUBLISH=0.0.0.0:5432` على الرئيسي + `docker compose restart postgres` |
| `connection refused` Redis | `REDIS_PUBLISH=0.0.0.0:6379` على الرئيسي |
| HLS لا يعمل للقناة على البعيد | رابط HLS في اللوحة = `http://WORKER_IP:8080/api/hls` |
| القناة لا تشتغل على السيرفر المحدد | السيرفر يجب أن يكون **متصل** وغير **ممتلئ** |
| `Cannot find package ssh2` | على الرئيسي: `docker compose build api && docker compose up -d api` |

---

## 8) سيرفر ثالث ورابع

كرّر الخطوات مع:
- `SERVER_ID=node-3` / `node-4` ...
- IP مختلف لكل جهاز
- hostname فريد في لوحة الإدارة

---

## روابط

- [README](../README.md)
- [INSTALL-TROUBLESHOOTING.md](INSTALL-TROUBLESHOOTING.md)
- [ARCHITECTURE.md](ARCHITECTURE.md) — قسم Multi-Server
