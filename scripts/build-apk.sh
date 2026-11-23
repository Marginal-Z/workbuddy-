#!/usr/bin/env bash
# 本机构建 Android APK（Debian/Ubuntu 环境）。
# 首次运行会安装 JDK 17 与 Android SDK（约 1.5 GB），之后复用缓存。
set -euo pipefail

SDK="${ANDROID_HOME:-/opt/android-sdk}"
WORK="${TMPDIR:-/tmp}/wb-android"
mkdir -p "$WORK"

need() { command -v "$1" >/dev/null 2>&1; }

if ! need java; then
  echo "[1/5] 安装 JDK 17 ..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq openjdk-17-jdk-headless unzip curl >/dev/null
fi

if [ ! -d "$SDK/cmdline-tools/latest" ]; then
  echo "[2/5] 下载 Android 命令行工具 ..."
  ZIP="$WORK/cmdline-tools.zip"
  node -e '
    const fs = require("node:fs");
    const out = process.argv[1];
    (async () => {
      const res = await fetch("https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip");
      if (!res.ok) throw new Error("download failed " + res.status);
      fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    })().catch((e) => { console.error(e.message); process.exit(1); });
  ' "$ZIP"
  mkdir -p "$SDK/cmdline-tools"
  rm -rf "$SDK/cmdline-tools/latest" "$SDK/cmdline-tools/cmdline-tools"
  unzip -q "$ZIP" -d "$SDK/cmdline-tools"
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -f "$ZIP"
fi

export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
export PATH="$SDK/cmdline-tools/latest/bin:$SDK/platform-tools:$PATH"

echo "[3/5] 安装 platform 34 / build-tools 34 ..."
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null

echo "[4/5] 同步 web 资源 ..."
cd "$(dirname "$0")/.."
npx cap sync android >/dev/null

echo "[5/5] Gradle 构建 debug APK ..."
cd android
chmod +x gradlew
./gradlew assembleDebug --no-daemon -Dorg.gradle.jvmargs=-Xmx2g

APK="$(pwd)/app/build/outputs/apk/debug/app-debug.apk"
ls -lh "$APK"
echo "APK: $APK"
