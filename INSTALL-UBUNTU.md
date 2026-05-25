# StreamRelay — تثبيت على Ubuntu 22.04 / 24.04

> **دليل Ubuntu 22 مفصّل:** [docs/INSTALL-UBUNTU-22.md](docs/INSTALL-UBUNTU-22.md)

---

## التثبيت السريع (Ubuntu 22)

```bash
sudo apt update && sudo apt install -y git curl
sudo git clone https://github.com/mmlktahmd4-cmd/streamrelay.git /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

أو:

```bash
sudo bash scripts/install-ubuntu22.sh
```

**أمر واحد من الإنترنت:**

```bash
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/install-from-github.sh | sudo bash -s -- https://github.com/mmlktahmd4-cmd/streamrelay.git
```

**تحديث:**

```bash
cd /opt/streamrelay && sudo bash scripts/update-from-github.sh
```

---

## الطريقة البديلة — حزمة tar (بدون Git)

### 1) على Windows — جهّز حزمة النقل

```powershell
cd Desktop\iptv
powershell -ExecutionPolicy Bypass -File scripts\pack-for-transfer.ps1
```

سيُنشأ: **`streamrelay-ubuntu.tar.gz`**

> Linux/Mac: `bash scripts/pack-for-transfer.sh`

### 2) انقل إلى Ubuntu 22

```bash
scp streamrelay-ubuntu.tar.gz root@IP-SERVER:/tmp/
```

### 3) ثبّت

```bash
sudo mkdir -p /opt/streamrelay
sudo tar -xzf /tmp/streamrelay-ubuntu.tar.gz -C /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

انتظر 5–15 دقيقة (أول بناء Docker).

---

## بعد التثبيت

| الخدمة | الرابط |
|--------|--------|
| لوحة الإدارة | `http://IP-SERVER/login` أو `:8080/login` |
| بوابة المشاهدة | `http://IP-SERVER/watch/login` |
| API | `http://IP-SERVER/api/health` |

```bash
cat /opt/streamrelay/INSTALL-CREDENTIALS.txt
docker compose ps
sudo bash scripts/check-ports.sh
```

- **المستخدم:** `admin`
- **كلمة المرور:** في `INSTALL-CREDENTIALS.txt`

---

## سكربتات التثبيت

| السكربت | الاستخدام |
|---------|-----------|
| `scripts/ubuntu-quick-install.sh` | التثبيت الكامل (22/24) |
| `scripts/install-ubuntu22.sh` | اختصار لـ Ubuntu 22 |
| `scripts/install-from-github.sh` | clone + تثبيت |
| `scripts/update-from-github.sh` | تحديث + إعادة بناء |
| `scripts/check-ports.sh` | فحص المنافذ |

---

## أوامر مهمة

```bash
cd /opt/streamrelay

docker compose ps
docker compose logs -f api
docker compose restart
sudo systemctl status streamrelay
```

---

## MikroTik / الشبكة

1. لوحة الإدارة → **MikroTik**
2. IP السيرفر (مثل `192.168.1.100`)
3. انسخ السكربت → MikroTik Terminal
4. العملاء: `http://IP-SERVER/watch/login`

---

## متطلبات Ubuntu

- Ubuntu **22.04 LTS** أو **24.04 LTS** (64-bit)
- 4 GB RAM (8 GB للبث)
- 20 GB قرص
- Docker + Docker Compose (يُثبّتان تلقائياً)

> إذا **80** مشغول (Apache/Nginx)، التثبيت يستخدم **8080** تلقائياً — موقعك الحالي لا يتأثر.

---

## استكشاف الأخطاء

```bash
sudo bash scripts/check-ports.sh
docker compose logs api
docker compose logs nginx
docker compose down && docker compose build --no-cache && docker compose up -d
```

> [docs/INSTALL-UBUNTU-22.md](docs/INSTALL-UBUNTU-22.md) — دليل استكشاف الأخطاء الكامل

---

## تطوير محلي

```bash
docker compose -f docker-compose.dev.yml up -d
cd backend && npm install && npm start
cd frontend && npm install && npm run dev
```

---

> GitHub: [INSTALL-GITHUB.md](INSTALL-GITHUB.md)
