#!/usr/bin/env bash
# Photo Craft Mobile — full Android build
# 1) Compiles the vendored PhotoCraft Rust core into Android cdylibs (cargo-ndk)
# 2) Drops them into app jniLibs (CMake links the JNI shim against them)
# 3) Runs the Gradle release/debug build (React Native + Kotlin + C++ JNI + ONNX)
#
# Requirements: rustup (stable ≥1.95), cargo-ndk, Android NDK 27, JDK 17+, Node 18+
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST="$ROOT/rust-core"
JNILIBS="$ROOT/android/app/src/main/jniLibs"
ABIS="${ABIS:-arm64-v8a armeabi-v7a}"
PROFILE="${PROFILE:-release}"

command -v cargo >/dev/null || { echo "Install Rust: https://rustup.rs"; exit 1; }
command -v cargo-ndk >/dev/null || cargo install cargo-ndk
[ -n "${ANDROID_NDK_HOME:-}" ] || { echo "Set ANDROID_NDK_HOME"; exit 1; }
rustup target add aarch64-linux-android armv7-linux-androideabi

echo "==> Building Rust core ($PROFILE) for: $ABIS"
cd "$RUST"
for abi in $ABIS; do
    case "$abi" in
        arm64-v8a)    target="aarch64-linux-android" ;;
        armeabi-v7a)  target="armv7-linux-androideabi" ;;
        x86_64)       target="x86_64-linux-android" ;;
        *) echo "unknown ABI $abi"; exit 1 ;;
    esac
    cargo ndk -t "$target" -p "photocraft-android-ffi" build --"$PROFILE"
done

echo "==> Collecting cdylibs into $JNILIBS"
mkdir -p "$JNILIBS"
for abi in $ABIS; do
    case "$abi" in
        arm64-v8a)    t="aarch64-linux-android" ;;
        armeabi-v7a)  t="armv7-linux-androideabi" ;;
        x86_64)       t="x86_64-linux-android" ;;
    esac
    dest="$JNILIBS/$abi"
    mkdir -p "$dest"
    cp -f "target/$t/$PROFILE/libphotocraft_android_ffi.so" "$dest/"
done

echo "==> JS bundle + Gradle build"
cd "$ROOT"
if [ ! -d node_modules ]; then
    npm install
fi

# Debug keystore (one-time) so Gradle can sign debug/release builds
KEYSTORE="$ROOT/android/app/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
    keytool -genkeypair -v -keystore "$KEYSTORE" -storepass android -alias androiddebugkey \
        -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Photo Craft Debug,O=PhotoCraft,C=EG" 2>/dev/null || true
fi

npx react-native bundle \
    --platform android --dev false \
    --entry-file index.js \
    --bundle-output android/app/src/main/assets/index.android.bundle \
    --assets-dest android/app/src/main/res || true

cd "$ROOT/android"
./gradlew assembleDebug assembleRelease

echo "==> APKs:"
ls -la app/build/outputs/apk/debug app/build/outputs/apk/release 2>/dev/null || true
