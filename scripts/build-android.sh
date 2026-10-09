#!/usr/bin/env bash
# Photo Craft Mobile — full Android build
# 1) Compiles the vendored PhotoCraft Rust core into Android cdylibs (cargo-ndk)
# 2) Drops them into app jniLibs (CMake links the JNI shim against them)
# 3) Runs the Gradle build (React Native + Kotlin + C++ JNI + ONNX)
#
# Requirements: rustup (stable >=1.95), cargo-ndk, Android NDK 27, JDK 17+, Node 18+
#
# The script is fail-fast: every mandatory step is verified, and no step that
# failed is ever reported as success.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST="$ROOT/rust-core"
JNILIBS="$ROOT/android/app/src/main/jniLibs"
# Must match reactNativeArchitectures in android/gradle.properties — Gradle
# packages every ABI in abiFilters, so every one of them needs its Rust .so.
ABIS="${ABIS:-arm64-v8a armeabi-v7a x86_64}"
PROFILE="${PROFILE:-release}"

fail() { echo "BUILD ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------- prerequisites
command -v cargo >/dev/null || fail "cargo not found — install Rust: https://rustup.rs"
command -v cargo-ndk >/dev/null || fail "cargo-ndk not found — install with: cargo install cargo-ndk"
[ -n "${ANDROID_NDK_HOME:-}" ] || fail "ANDROID_NDK_HOME is not set (point it at the NDK 27 install)"
[ -d "$ANDROID_NDK_HOME" ] || fail "ANDROID_NDK_HOME=$ANDROID_NDK_HOME does not exist"
command -v node >/dev/null || fail "node not found — Node 18+ is required"
command -v keytool >/dev/null || fail "keytool not found — a JDK 17+ install is required for signing"

RUST_VERSION_OK=$(rustc --version | grep -oE '[0-9]+\.[0-9]+' | head -1) || true
echo "==> Rust $(rustc --version), NDK $ANDROID_NDK_HOME"
echo "==> ABIs: $ABIS (profile: $PROFILE)"

rustup target list --installed | grep -q aarch64-linux-android || rustup target add aarch64-linux-android
rustup target list --installed | grep -q armv7-linux-androideabi || rustup target add armv7-linux-androideabi
if [[ " $ABIS " == *" x86_64 "* ]]; then
    rustup target list --installed | grep -q x86_64-linux-android || rustup target add x86_64-linux-android
fi

# ------------------------------------------------------------------ Rust core
echo "==> Building Rust core ($PROFILE) for: $ABIS"
cd "$RUST"
for abi in $ABIS; do
    case "$abi" in
        arm64-v8a)    target="aarch64-linux-android" ;;
        armeabi-v7a)  target="armv7-linux-androideabi" ;;
        x86_64)       target="x86_64-linux-android" ;;
        *) fail "unknown ABI '$abi' (expected arm64-v8a | armeabi-v7a | x86_64)" ;;
    esac
    cargo ndk -t "$target" -p "photocraft-android-ffi" build --"$PROFILE" \
        || fail "Rust build failed for $abi ($target)"
done

# ---------------------------------------------------------------- collect libs
echo "==> Collecting cdylibs into $JNILIBS"
mkdir -p "$JNILIBS"
for abi in $ABIS; do
    case "$abi" in
        arm64-v8a)    t="aarch64-linux-android" ;;
        armeabi-v7a)  t="armv7-linux-androideabi" ;;
        x86_64)       t="x86_64-linux-android" ;;
    esac
    src="target/$t/$PROFILE/libphotocraft_android_ffi.so"
    [ -f "$src" ] || fail "expected Rust cdylib was not produced: $src"
    dest="$JNILIBS/$abi"
    mkdir -p "$dest"
    cp -f "$src" "$dest/"
done

# ------------------------------------------------------------ JS bundle + deps
cd "$ROOT"
if [ ! -d node_modules ]; then
    echo "==> npm install"
    npm install || fail "npm install failed"
fi

# Debug keystore (one-time) so Gradle can sign debug/release builds.
KEYSTORE="$ROOT/android/app/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
    echo "==> Generating debug keystore"
    keytool -genkeypair -v -keystore "$KEYSTORE" -storepass android -alias androiddebugkey \
        -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Photo Craft Debug,O=PhotoCraft,C=EG" \
        || fail "debug keystore generation failed (keytool reported an error)"
fi

ASSETS_DIR="$ROOT/android/app/src/main/assets"
BUNDLE="$ASSETS_DIR/index.android.bundle"
echo "==> Bundling JS (release)"
mkdir -p "$ASSETS_DIR"
npx react-native bundle \
    --platform android --dev false \
    --entry-file index.js \
    --bundle-output "$BUNDLE" \
    --assets-dest "$ROOT/android/app/src/main/res" \
    || fail "Metro JS bundling failed (fix the bundler error above; a stale bundle is never shipped)"
[ -s "$BUNDLE" ] || fail "JS bundle missing/empty at $BUNDLE"

# ------------------------------------------------------------------ Gradle build
cd "$ROOT/android"
if [ ! -f gradle/wrapper/gradle-wrapper.jar ]; then
    fail "gradle wrapper jar missing — run 'gradle wrapper' or restore android/gradle/wrapper/"
fi
echo "==> Gradle assembleDebug + assembleRelease"
./gradlew assembleDebug assembleRelease \
    || fail "Gradle build failed — see the Gradle output above"

echo "==> APKs:"
ls -la app/build/outputs/apk/debug app/build/outputs/apk/release 2>/dev/null || true
echo "==> Build finished."
