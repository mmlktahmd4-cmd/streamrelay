# StreamRelay — GitHub: التثبيت والتحديث

**المستودع:** https://github.com/mmlktahmd4-cmd/streamrelay

---

## 1) التثبيت السهل (Ubuntu 22 / 24)

### أمر واحد:

```bash
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/easy-install.sh | sudo bash
```

### أو clone + تثبيت (يجب حذف المجلد القديم أولاً):

```bash
sudo apt install -y git curl
sudo rm -rf /opt/streamrelay
sudo git clone https://github.com/mmlktahmd4-cmd/streamrelay.git /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

> **مهم:** بدون `sudo rm -rf /opt/streamrelay` — `git clone` **يفشل** ويبقى كود قديم.

### أو نفس easy-install (clone + تثبيت تلقائي):

```bash
curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/clone-install.sh | sudo bash
```

---

## 2) ماذا يفعل التثبيت؟

| الخطوة | الوصف |
|--------|--------|
| Docker | تثبيت Docker + Compose |
| `.env` | إنشاء إعدادات + كلمات سر عشوائية |
| Frontend | بناء لوحة التحكم |
| Docker | postgres, redis, api, worker, frontend, nginx |
| systemd | تشغيل تلقائي بعد reboot |

---

## 3) بعد التثبيت

```bash
cat /opt/streamrelay/INSTALL-CREDENTIALS.txt
curl http://127.0.0.1/api/health
```

| الخدمة | الرابط |
|--------|--------|
| الإدارة | `http://SERVER-IP/login` |
| المشاهدة | `http://SERVER-IP/watch/login` |

---

## 4) التحديث

```bash
cd /opt/streamrelay
sudo bash scripts/update-from-github.sh
```

---

## 5) سكربتات الصيانة

```bash
sudo bash scripts/fix-server-ip.sh          # تصحيح IP
sudo bash scripts/launch-production.sh      # إطلاق إنتاج
sudo bash scripts/deploy-update.sh          # بناء + restart
sudo bash scripts/check-ports.sh            # فحص المنافذ
sudo bash scripts/reset-admin-password.sh   # reset admin
```

---

## 6) ما لا يُرفع على GitHub

- `.env` — كلمات السر
- `node_modules/`
- `frontend/dist/`
- `data/hls/` — ملفات البث
- `INSTALL-CREDENTIALS.txt`

---

## 7) مستودع خاص (Private)

```bash
# Token (HTTPS)
sudo git clone https://TOKEN@github.com/USER/streamrelay.git /opt/streamrelay

# SSH
sudo git clone git@github.com:USER/streamrelay.git /opt/streamrelay
```

---

## 8) رفع التعديلات من السيرفر

```bash
cd /home/USER/streamrelay
git add .
git commit -m "وصف التعديل"
git push origin main
```

---

## 9) استكشاف الأخطاء

```bash
docker compose ps
docker compose logs api --tail 50
sudo bash scripts/launch-production.sh
```

**502 Bad Gateway:** عادة API متوقف — `docker compose restart api`

**IP خاطئ (172.18.x):** `sudo bash scripts/fix-server-ip.sh`

---

## 10) روابط مهمة

- المستودع: https://github.com/mmlktahmd4-cmd/streamrelay
- دليل Ubuntu: [docs/INSTALL-UBUNTU-22.md](docs/INSTALL-UBUNTU-22.md)
- **ربط سيرفر بث يدوياً:** [docs/MANUAL-SERVER-LINKING.md](docs/MANUAL-SERVER-LINKING.md)
