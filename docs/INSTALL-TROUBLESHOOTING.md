# StreamRelay — استكشاف أخطاء التثبيت (Ubuntu 22 / 24)

> يُحدَّث مع كل مشكلة جديدة. قبل التثبيت: `sudo bash scripts/install-preflight.sh`

---

## 0) حذف كامل وإعادة تثبيت (سيرفر نظيف)

**حذف كل شيء + تثبيت جديد — أمر واحد:**
```bash
cd / && curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/reset-server.sh | sudo bash
```

**حذف فقط (بدون تثبيت):**
```bash
cd / && curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/wipe-server.sh | sudo bash
```

> **مهم:** دائماً `cd /` أولاً — لا تحذف `/opt/streamrelay` وأنت داخله.

---

**الخطأ:**
```
awk: cmd. line:1: {print $1"."$2"."$3".0/24}
awk: syntax error
```

**السبب:** أمر `awk` لتحويل IP إلى subnet بدون اقتباس صحيح — كان في إصدارات قديمة:
```bash
# ❌ يسبب الخطأ
echo "$IP" | awk -F. {print $1"."$2"."$3".0/24}
# ✅ الصحيح (لكن السكript الحديث لا يستخدم awk)
echo "$IP" | awk -F. '{print $1"."$2"."$3".0/24}'
```

**الحل الدائم (النسخة الحالية):** `scripts/lib/network.sh` — bash فقط، **بدون awk**.

**على السيرفر — أمر واحد:**
```bash
cd /opt/streamrelay
sudo git config --global --add safe.directory /opt/streamrelay
sudo git pull origin main
grep -q 'lib/network.sh' scripts/ubuntu-quick-install.sh && echo "OK: نسخة محدثة" || echo "FAIL: ما زالت قديمة"
sudo bash scripts/ubuntu-quick-install.sh
```

**تثبيت جديد من GitHub:**
```bash
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/easy-install.sh | sudo bash
```

**تحقق:** عند التثبيت يظهر `install-scripts: 2026.05.26-awkfix3`

**يدوياً (بدون awk):**
```bash
IP=$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.' | grep -v '^127\.' | head -1)
echo "$IP"
```

---

## 1b) getcwd / BASH_SOURCE unbound / install-from-github not found

**الخطأ:**
```
shell-init: error retrieving current directory: getcwd: cannot access parent directories
bash: line 14: BASH_SOURCE[0]: unbound variable
bash: ./install-from-github.sh: No such file or directory
```

**السبب:** حذفت `/opt/streamrelay` بينما الطرفية **داخل** هذا المجلد (`cd /opt/streamrelay` ثم `rm -rf`).

**الحل — نفّذ بالترتيب (سطر سطر):**
```bash
cd /
pwd
sudo rm -rf /opt/streamrelay
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/install-from-github.sh | sudo bash
```

> **مهم:** إذا كان الـ prompt ما زال يظهر `/opt/streamrelay` — نفّذ `cd /` **أولاً** قبل أي أمر آخر.

---

**الخطأ:** `cannot execute: Permission denied`

**الحل:**
```bash
sudo bash scripts/ubuntu-quick-install.sh
# أو:
chmod +x scripts/*.sh
```

---

## 3) git: dubious ownership

**الخطأ:** `fatal: detected dubious ownership in repository at '/opt/streamrelay'`

**الحل:**
```bash
sudo git config --global --add safe.directory /opt/streamrelay
cd /opt/streamrelay && sudo git pull
```

---

## 4) yaml: mapping values are not allowed

**الخطأ:** `docker-compose.yml` تالف (سطر `services:  postgres:`)

**الحل:**
```bash
cd /opt/streamrelay
sudo git pull
python3 -c "from pathlib import Path; p=Path('docker-compose.yml'); p.write_text(p.read_text().replace('services:  postgres:','services:\n\n  postgres:',1))"
docker compose config
```

---

## 5) منافذ مشغولة (address already in use)

| المنفذ | الحل |
|--------|------|
| 6379 Redis | `sudo systemctl stop redis-server` |
| 5432 PostgreSQL | `sudo systemctl stop postgresql` |
| 80 / 443 Apache | السكript يستخدم **8080** تلقائياً — لا توقف Apache |
| 3000 | `sudo ss -tlnp \| grep 3000` ثم أوقف البرنامج |

**فحص:**
```bash
sudo bash scripts/check-ports.sh
```

> الإصدارات الجديدة: postgres/redis/api **لا تفتح منافذ** على المضيف — فقط nginx.

---

## 6) sr-nginx Restarting

```bash
docker logs sr-nginx --tail 30
cd /opt/streamrelay && sudo git pull
docker compose up -d --force-recreate nginx
```

---

## 7) مستودع GitHub خاص — Authentication failed

**الحل:** اجعل المستودع **Public** أو استخدم **Personal Access Token** في clone.

---

## 8) API unhealthy

```bash
docker compose logs api --tail 50
docker compose exec api wget -qO- http://127.0.0.1:3000/api/health
```

---

## 9) إعادة بناء كامل

```bash
cd /opt/streamrelay
docker compose down
docker compose build --no-cache
docker compose up -d
```

---

## 10) تحديث آمن بدون ضياع الإعدادات

```bash
cd /opt/streamrelay
sudo bash scripts/safe-update.sh
```

يحافظ على: `.env`, كلمات السر, قاعدة البيانات, ملفات البث.

---

## 11) أوامر مفيدة

```bash
cd /opt/streamrelay
sudo bash scripts/install-preflight.sh   # فحص قبل التثبيت
sudo bash scripts/ubuntu-quick-install.sh
sudo bash scripts/check-ports.sh
docker compose ps
cat INSTALL-CREDENTIALS.txt
```

---

## روابط

- [INSTALL-UBUNTU-22.md](INSTALL-UBUNTU-22.md)
- [INSTALL-UBUNTU.md](../INSTALL-UBUNTU.md)
