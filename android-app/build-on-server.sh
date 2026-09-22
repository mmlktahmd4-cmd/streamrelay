#!/usr/bin/env bash
# ============================================================
# بناء تطبيق الأندرويد (StreamRelay TV) على سيرفر لينكس بواسطة Docker.
# لا يحتاج Android Studio: الصورة تحوي JDK 21 + Android SDK 36، و Gradle يُنزَّل مرة واحدة.
#
# الاستخدام (على السيرفر):
#   1) انسخ مجلد android-app كاملاً إلى $BASE/app.tgz (tar czf app.tgz android-app)
#   2) ضع مفتاح التوقيع في $BASE/signing/ (streamrelay-release.jks + signing.properties)
#   3) sudo bash android-app/build-on-server.sh
# الناتج: $BASE/out/StreamRelay.apk
# ============================================================
set -euo pipefail
BASE="${BASE:-/opt/streamrelay-app}"
IMAGE="${IMAGE:-ghcr.io/cirruslabs/flutter:stable}"
GRADLE_VER="${GRADLE_VER:-8.11.1}"

mkdir -p "$BASE/gradle-home" "$BASE/gradle-dist" "$BASE/out" "$BASE/signing"
[ -f "$BASE/app.tgz" ] || { echo "✗ لا يوجد $BASE/app.tgz"; exit 1; }

docker run --rm \
  --memory=6g \
  -e GRADLE_USER_HOME=/gh \
  -e GRADLE_VER="$GRADLE_VER" \
  -v "$BASE/gradle-home:/gh" \
  -v "$BASE/gradle-dist:/gd" \
  -v "$BASE/app.tgz:/src/app.tgz:ro" \
  -v "$BASE/out:/out" \
  -v "$BASE/signing:/signing:ro" \
  "$IMAGE" bash -lc '
    set -e
    export GRADLE_USER_HOME=/gh
    if [ ! -x "/gd/gradle-$GRADLE_VER/bin/gradle" ]; then
      echo "تنزيل Gradle $GRADLE_VER (مرة واحدة)…"
      cd /gd && curl -fsSL -o g.zip "https://services.gradle.org/distributions/gradle-$GRADLE_VER-bin.zip" && unzip -q g.zip && rm -f g.zip
    fi
    rm -rf /work && mkdir -p /work && cd /work && tar -xzf /src/app.tgz && cd android-app
    mkdir -p signing && cp -f /signing/* signing/ 2>/dev/null || true
    yes | sdkmanager --licenses >/dev/null 2>&1 || true
    java -version 2>&1 | head -1
    "/gd/gradle-$GRADLE_VER/bin/gradle" --no-daemon --console=plain assembleRelease
    ls -lh app/build/outputs/apk/release/
    cp -f app/build/outputs/apk/release/app-release.apk /out/StreamRelay.apk
    echo "APK_OK $(stat -c %s /out/StreamRelay.apk) bytes"
  '
ls -lh "$BASE/out/StreamRelay.apk"
