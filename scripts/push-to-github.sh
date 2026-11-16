#!/bin/bash
# رفع التحديثات إلى GitHub
# الاستخدام: bash scripts/push-to-github.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

export PATH="/home/aaaaa/.local/bin:$PATH"

if gh auth status >/dev/null 2>&1; then
  echo "=== رفع عبر GitHub CLI ==="
  gh auth setup-git
  git push origin main
  echo "تم الرفع بنجاح ✓"
  exit 0
fi

if ssh -o BatchMode=yes -T git@github.com 2>&1 | grep -qi 'successfully authenticated'; then
  git remote set-url origin git@github.com:mmlktahmd4-cmd/streamrelay.git
  git push origin main
  echo "تم الرفع بنجاح ✓"
  exit 0
fi

echo "=============================================="
echo "  مطلوب تسجيل دخول GitHub (مرة واحدة فقط)"
echo "=============================================="
echo ""
echo "شغّل هذا الأمر واتبع الرابط:"
echo ""
echo "  gh auth login --hostname github.com --git-protocol https --web"
echo ""
echo "أو أضف مفتاح SSH من:"
echo "  cat ~/.ssh/id_ed25519.pub"
echo ""
echo "إلى: https://github.com/settings/ssh/new"
echo "=============================================="
exit 1
