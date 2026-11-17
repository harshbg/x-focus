#!/usr/bin/env bash
# Builds x-focus.apk without Gradle.
# Needs javac, aapt2, dx, zipalign, apksigner and an android.jar. On Ubuntu:
#   apt install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
set -euo pipefail
cd "$(dirname "$0")"
ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
VERSION_NAME="$(grep -m1 '@version' ../x-focus.user.js | awk '{print $3}')"
VERSION_CODE="${VERSION_CODE:-$(date +%s)}"

rm -rf build && mkdir -p build/classes build/gen/app/xfocus assets
cp ../x-focus.user.js assets/x-focus.user.js

# Where the app looks for newer versions of the script (first line of update-url.txt; empty = never).
UPDATE_URL="${UPDATE_URL:-$(head -n1 update-url.txt 2>/dev/null | tr -d '[:space:]' || true)}"
case "$UPDATE_URL" in ""|https://*) ;; *) echo "update URL must be https"; exit 1 ;; esac
printf 'package app.xfocus;\n\nfinal class Config {\n    static final String UPDATE_URL = "%s";\n}\n' "$UPDATE_URL" > build/gen/app/xfocus/Config.java

aapt2 compile --dir res -o build/res.zip
aapt2 link -o build/unsigned.apk -I "$ANDROID_JAR" --manifest AndroidManifest.xml -A assets \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" build/res.zip

if ! javac -nowarn -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d build/classes src/app/xfocus/*.java build/gen/app/xfocus/*.java 2>build/javac.log; then
  cat build/javac.log
  exit 1
fi
dalvik-exchange --dex --min-sdk-version=24 --output=build/classes.dex build/classes
(cd build && zip -q -j unsigned.apk classes.dex)
zipalign -f 4 build/unsigned.apk build/aligned.apk

# One signing key for every build, so updates install over the old version.
if [ ! -f signing.jks ]; then
  keytool -genkeypair -keystore signing.jks -storepass xfocus -keypass xfocus -alias xfocus \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=X Focus" >/dev/null 2>&1
fi
apksigner sign --ks signing.jks --ks-pass pass:xfocus --key-pass pass:xfocus --ks-key-alias xfocus \
  --out ../x-focus.apk build/aligned.apk
rm -f ../x-focus.apk.idsig
echo "Built ../x-focus.apk ($VERSION_NAME, code $VERSION_CODE, updates from ${UPDATE_URL:-nowhere})"
