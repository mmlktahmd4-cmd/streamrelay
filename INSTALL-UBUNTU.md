# StreamRelay — تثبيت سريع على Ubuntu 22 / 24

> **مشاكل التثبيت:** [docs/INSTALL-TROUBLESHOOTING.md](docs/INSTALL-TROUBLESHOOTING.md)
> دليل مفصّل: [docs/INSTALL-UBUNTU-22.md](docs/INSTALL-UBUNTU-22.md)

---

## أمر واحد (الأسهل)

```bash
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/easy-install.sh | sudo bash
```

---

## تثبيت يدوي

```bash
sudo apt update && sudo apt install -y git curl
sudo git clone https://github.com/mmlktahmd4-cmd/streamrelay.git /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

---

## بعد التثبيت

| | |
|---|---|
| **الإدارة** | `http://IP-SERVER/login` |
| **المشاهدة** | `http://IP-SERVER/watch/login` |
| **بيانات الدخول** | `cat /opt/streamrelay/INSTALL-CREDENTIALS.txt` |

---

## التحديث

```bash
cd /opt/streamrelay
sudo bash scripts/update-from-github.sh
```

---

## إصلاح IP / إعادة الإطلاق

```bash
sudo bash /opt/streamrelay/scripts/fix-server-ip.sh
sudo bash /opt/streamrelay/scripts/launch-production.sh
```

---

## سكربتات

| السكربت | الاستخدام |
|---------|-----------|
| `easy-install.sh` | تثبيت كامل بأمر واحد |
| `ubuntu-quick-install.sh` | تثبيت من مجلد المشروع |
| `update-from-github.sh` | تحديث من GitHub |
| `deploy-update.sh` | بناء + إعادة تشغيل |
| `launch-production.sh` | إطلاق إنتاج |
| `fix-server-ip.sh` | تصحيح IP الشبكة |
| `install-preflight.sh` | فحص قبل التثبيت |

---

## GitHub

https://github.com/mmlktahmd4-cmd/streamrelay
