# رفع المشروع على GitHub والتثبيت من هناك

## 1) رفع المشروع من Windows

### الطريقة أ — GitHub Desktop (الأسهل)

1. حمّل [GitHub Desktop](https://desktop.github.com/)
2. **File → Add Local Repository** → اختر مجلد `iptv`
3. **Publish repository** → اسم المستودع: `streamrelay` → Private (موصى به)
4. اضغط **Publish**

### الطريقة ب — سطر الأوامر

```powershell
# ثبّت Git من: https://git-scm.com/download/win
cd Desktop\iptv

git init
git add .
git commit -m "Initial commit — StreamRelay IPTV"
git branch -M main
git remote add origin https://github.com/mmlktahmd4-cmd/streamrelay.git
git push -u origin main
```

> أنشئ مستودعاً فارغاً أولاً على [github.com/new](https://github.com/new) بدون README.

---

## 2) ما لا يُرفع على GitHub (محمي تلقائياً)

- `.env` — كلمات السر
- `node_modules/`
- `data/hls/` — ملفات البث
- `INSTALL-CREDENTIALS.txt`

---

## 3) التثبيت على Ubuntu 24 من GitHub

### أمر واحد:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/mmlktahmd4-cmd/streamrelay/main/scripts/install-from-github.sh)" -- https://github.com/mmlktahmd4-cmd/streamrelay.git
```

### أو خطوة بخطوة:

```bash
sudo apt install -y git
sudo git clone https://github.com/mmlktahmd4-cmd/streamrelay.git /opt/streamrelay
cd /opt/streamrelay
sudo bash scripts/ubuntu-quick-install.sh
```

---

## 4) التحديث لاحقاً

```bash
cd /opt/streamrelay
sudo bash scripts/update-from-github.sh
```

---

## 5) مستودع خاص (Private)

- التثبيت يحتاج **Personal Access Token** أو SSH:

```bash
# Token (HTTPS)
sudo git clone https://TOKEN@github.com/mmlktahmd4-cmd/streamrelay.git /opt/streamrelay

# SSH
sudo git clone git@github.com:mmlktahmd4-cmd/streamrelay.git /opt/streamrelay
```

---

## 6) رابط المستودع

https://github.com/mmlktahmd4-cmd/streamrelay
