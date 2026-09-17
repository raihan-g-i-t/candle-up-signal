#!/usr/bin/env bash
# Builds CandleUpSignal.apk with the plain Android SDK tools (no Gradle needed).
# Re-run after changing ../index.html or ../scanner.js to get an updated APK.
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
PLATFORM="$SDK/platforms/$(ls "$SDK/platforms" | sort -V | tail -1)/android.jar"
OUT=build
rm -rf "$OUT" && mkdir -p "$OUT/assets" "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "== assets"
cp ../scanner.js "$OUT/assets/"
LWC=lightweight-charts.standalone.production.js
[ -f "cache/$LWC" ] || { mkdir -p cache; curl -fsSL "https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/$LWC" -o "cache/$LWC"; }
cp "cache/$LWC" "$OUT/assets/"
# use the bundled chart library instead of the CDN so charts work without extra downloads
sed "s#https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/$LWC#$LWC#" ../index.html > "$OUT/assets/index.html"

echo "== resources"
"$BT/aapt2" compile --dir res -o "$OUT/res.zip"
"$BT/aapt2" link -I "$PLATFORM" --manifest AndroidManifest.xml -A "$OUT/assets" \
  --java "$OUT/gen" -o "$OUT/app-unsigned.apk" "$OUT/res.zip"

echo "== java"
javac -source 11 -target 11 -nowarn -Xlint:-options -classpath "$PLATFORM" -d "$OUT/classes" \
  $(find src "$OUT/gen" -name '*.java')
"$BT/d8" --release --min-api 26 --lib "$PLATFORM" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
(cd "$OUT/dex" && zip -q -j ../app-unsigned.apk classes.dex)

echo "== sign"
KEY=release.keystore
[ -f "$KEY" ] || keytool -genkeypair -keystore "$KEY" -alias candleup -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass candleup -keypass candleup -dname "CN=Candle Up Signal" >/dev/null 2>&1
"$BT/zipalign" -f -p 4 "$OUT/app-unsigned.apk" "$OUT/app-aligned.apk"
"$BT/apksigner" sign --ks "$KEY" --ks-pass pass:candleup --key-pass pass:candleup \
  --out ../CandleUpSignal.apk "$OUT/app-aligned.apk"
"$BT/apksigner" verify ../CandleUpSignal.apk
echo "== done: $(cd .. && pwd)/CandleUpSignal.apk ($(du -h ../CandleUpSignal.apk | cut -f1))"
