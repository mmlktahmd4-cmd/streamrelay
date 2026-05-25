# StreamRelay IPTV

منصة IPTV لإدارة القنوات، البث الداخلي (HLS relay)، بوابة مشاهدة، وربط MikroTik.

## التثبيت السريع — Ubuntu 22 / 24

```bash
sudo apt update && sudo apt install -y git curl
sudo git clone https://github.com/mmlktahmd4-cmd/streamrelay.git /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

أو بأمر واحد:

```bash
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/install-from-github.sh | sudo bash -s -- https://github.com/mmlktahmd4-cmd/streamrelay.git
```

> المستودع: https://github.com/mmlktahmd4-cmd/streamrelay

## بعد التثبيت

| الخدمة | الرابط |
|--------|--------|
| لوحة الإدارة | `http://SERVER-IP/login` (أو `:8080` إذا Apache على 80) |
| بوابة المشاهدة | `http://SERVER-IP/watch/login` |

```bash
cat /opt/streamrelay/INSTALL-CREDENTIALS.txt   # admin + كلمة المرور
sudo bash /opt/streamrelay/scripts/check-ports.sh
```

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

| الملف | المحتوى |
|-------|---------|
| [docs/INSTALL-UBUNTU-22.md](docs/INSTALL-UBUNTU-22.md) | **دليل Ubuntu 22 الكامل** |
| [INSTALL-UBUNTU.md](INSTALL-UBUNTU.md) | ملخص التثبيت |
| [INSTALL-GITHUB.md](INSTALL-GITHUB.md) | GitHub |

## سكربتات التثبيت

| السكربت | الوظيفة |
|---------|---------|
| `scripts/ubuntu-quick-install.sh` | تثبيت كامل |
| `scripts/install-ubuntu22.sh` | اختصار Ubuntu 22 |
| `scripts/install-from-github.sh` | clone + تثبيت |
| `scripts/update-from-github.sh` | تحديث |
| `scripts/check-ports.sh` | فحص المنافذ |

## المتطلبات

- Ubuntu 22.04 / 24.04 LTS
- Docker + Docker Compose (تلقائي)
- 4 GB RAM (8 GB للبث)
- FFmpeg (داخل Docker)

## الترخيص

Public — https://github.com/mmlktahmd4-cmd/streamrelay
