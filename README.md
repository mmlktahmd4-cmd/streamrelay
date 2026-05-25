# StreamRelay IPTV

منصة IPTV لإدارة القنوات، البث الداخلي (HLS relay)، بوابة مشاهدة، ربط MikroTik، وعدادات استهلاك الشبكة (سحب/خروج) بتحديث كل ثانية.

**المستودع:** https://github.com/mmlktahmd4-cmd/streamrelay

---

## التثبيت السهل — أمر واحد (Ubuntu 22 / 24)

```bash
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/easy-install.sh | sudo bash
```

أو خطوة بخطوة:

```bash
sudo apt update && sudo apt install -y git curl
sudo git clone https://github.com/mmlktahmd4-cmd/streamrelay.git /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

> **مهم:** استخدم دائماً `sudo bash scripts/...` وليس `./scripts/...`

---

## بعد التثبيت

| الخدمة | الرابط |
|--------|--------|
| لوحة الإدارة | `http://SERVER-IP/login` |
| بوابة المشاهدة | `http://SERVER-IP/watch/login` |
| فحص API | `http://SERVER-IP/api/health` |

```bash
cat /opt/streamrelay/INSTALL-CREDENTIALS.txt   # admin + كلمة المرور
sudo bash /opt/streamrelay/scripts/check-ports.sh
```

- **المستخدم:** `admin`
- **كلمة المرور:** في `INSTALL-CREDENTIALS.txt` أو `.env`

> إذا منفذ **80** مشغول (Apache/Nginx) يُستخدم **8080** تلقائياً.

---

## التحديث من GitHub

```bash
cd /opt/streamrelay
sudo bash scripts/update-from-github.sh
```

---

## سكربتات التثبيت والصيانة

| السكربت | الوظيفة |
|---------|---------|
| `scripts/easy-install.sh` | **التثبيت السهل** — clone + تثبيت كامل |
| `scripts/ubuntu-quick-install.sh` | تثبيت كامل (Docker + .env + frontend) |
| `scripts/install-from-github.sh` | استنساخ من GitHub ثم تثبيت |
| `scripts/update-from-github.sh` | git pull + بناء + إعادة تشغيل |
| `scripts/deploy-update.sh` | بناء frontend + إعادة تشغيل Docker |
| `scripts/launch-production.sh` | إطلاق إنتاج (IP + بناء + Docker) |
| `scripts/fix-server-ip.sh` | تصحيح IP الشبكة وروابط القنوات |
| `scripts/check-ports.sh` | فحص المنافذ |
| `scripts/reset-admin-password.sh` | إعادة تعيين كلمة مرور admin |

---

## أوامر مفيدة

```bash
cd /opt/streamrelay

docker compose ps
docker compose logs -f api
docker compose restart api worker
sudo systemctl status streamrelay
```

---

## الميزات

- إدارة قنوات IPTV مع FFmpeg relay
- HLS داخلي مع روابط موقّعة
- بوابة مشاهدة منفصلة (`/watch/login`)
- ربط MikroTik
- **عدادات استهلاك:** سحب (داخل) + بث خارج (للمشاهدين) — تحديث كل ثانية
- كشف IP الشبكة المحلية (تجاهل Docker/VPN)

---

## ما لا تستخدمه

| ❌ خطأ | ✅ الصحيح |
|--------|-----------|
| `:8888` | المنفذ 80 أو 8080 |
| `/api/panel` | `/login` |
| فتح `.m3u8` مباشرة في Chrome | `/watch` أو `/player` |

---

## التوثيق

| الملف | المحتوى |
|-------|---------|
| [docs/INSTALL-UBUNTU-22.md](docs/INSTALL-UBUNTU-22.md) | دليل Ubuntu 22/24 الكامل |
| [INSTALL-UBUNTU.md](INSTALL-UBUNTU.md) | ملخص التثبيت |
| [INSTALL-GITHUB.md](INSTALL-GITHUB.md) | GitHub والتحديث |

---

## التطوير المحلي

```bash
docker compose -f docker-compose.dev.yml up -d
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

---

## المتطلبات

- Ubuntu 22.04 / 24.04 LTS
- Docker + Docker Compose (يُثبّتان تلقائياً)
- 4 GB RAM (8 GB للبث)
- FFmpeg (داخل Docker)

---

## الترخيص

Public — https://github.com/mmlktahmd4-cmd/streamrelay
