# StreamRelay IPTV

منصة IPTV لإدارة القنوات، البث الداخلي (HLS relay)، بوابة مشاهدة، وربط MikroTik.

## التثبيت السريع — Ubuntu 24

```bash
sudo apt install -y git
sudo git clone https://github.com/YOUR_USER/streamrelay.git /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

أو بأمر واحد:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USER/streamrelay/main/scripts/install-from-github.sh | sudo bash -s -- https://github.com/YOUR_USER/streamrelay.git
```

> استبدل `YOUR_USER/streamrelay` برابط مستودعك.

## بعد التثبيت

| الخدمة | الرابط |
|--------|--------|
| لوحة الإدارة | `http://SERVER-IP/login` |
| بوابة المشاهدة | `http://SERVER-IP/watch/login` |

الدخول الافتراضي: `admin` — كلمة المرور في `/opt/streamrelay/INSTALL-CREDENTIALS.txt`

## التحديث من GitHub

```bash
cd /opt/streamrelay
sudo bash scripts/update-from-github.sh
```

## التطوير المحلي

```bash
docker compose -f docker-compose.dev.yml up -d
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## التوثيق

- [INSTALL-UBUNTU.md](INSTALL-UBUNTU.md) — دليل التثبيت الكامل
- [INSTALL-GITHUB.md](INSTALL-GITHUB.md) — رفع المشروع على GitHub

## المتطلبات

- Ubuntu 24.04 LTS
- Docker + Docker Compose
- 4 GB RAM (8 GB للبث)
- FFmpeg (داخل Docker)

## الترخيص

Private — للاستخدام الداخلي.
