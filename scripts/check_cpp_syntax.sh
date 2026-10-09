#!/usr/bin/env bash
# Static C++ syntax + API-usage validation of the JNI bridge.
#
# Uses the host g++ with the authoritative OpenJDK jni.h/jni_md.h (downloaded
# once into .check-cache/, not committed) plus a minimal android/log.h stub.
#
# Honest scope: this validates syntax, types and JNIEnv API usage with a real
# compiler. It is NOT an NDK build — it neither links nor proves Android
# runtime behaviour (that needs the NDK toolchain, per README build docs).
set -euo pipefail
cd "$(dirname "$0")/.."

CACHE=".check-cache"
mkdir -p "$CACHE"
if [ ! -s "$CACHE/jni.h" ]; then
    curl -sL --fail -o "$CACHE/jni.h" \
        "https://raw.githubusercontent.com/openjdk/jdk/jdk-21-ga/src/java.base/share/native/include/jni.h"
fi
if [ ! -s "$CACHE/jni_md.h" ]; then
    # Linux ABI variant (LP64 jlong = long).
    curl -sL --fail -o "$CACHE/jni_md.h" \
        "https://raw.githubusercontent.com/openjdk/jdk/jdk-21-ga/src/java.base/unix/native/include/jni_md.h"
fi

STUB="$(mktemp -d)"
trap 'rm -rf "$STUB"' EXIT
mkdir -p "$STUB/android"
cat > "$STUB/android/log.h" <<'EOF'
#pragma once
#define ANDROID_LOG_INFO 4
#define ANDROID_LOG_WARN 5
#define ANDROID_LOG_ERROR 6
extern "C" int __android_log_print(int prio, const char* tag, const char* fmt, ...);
EOF

g++ -std=c++17 -fsyntax-only -Wall -Wextra -Wno-unused-parameter \
    -I"$CACHE" -I"$STUB" \
    android/app/src/main/cpp/photocraft_jni.cpp

echo "C++ syntax check OK: android/app/src/main/cpp/photocraft_jni.cpp"
