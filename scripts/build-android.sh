#!/usr/bin/env bash
# PhotoCraft for Android — build (Linux / macOS).
#
# Builds the Rust engine for the selected ABIs with cargo-ndk and then assembles the APK with
# Gradle. Nothing is downloaded except what Gradle and cargo fetch for the build itself (model
# weights are only fetched with --with-models).
#
# Usage:
#   scripts/build-android.sh                      # release APKs for arm64-v8a, armeabi-v7a, x86_64 + universal
#   scripts/build-android.sh --debug              # debug build
#   scripts/build-android.sh --abi arm64-v8a      # only one ABI (repeatable)
#   scripts/build-android.sh --with-models        # also download the background-removal models
#   scripts/build-android.sh --skip-native        # reuse an existing libphotocraft.so
#   scripts/build-android.sh --bundle             # also build the .aab for the Play Store
#   scripts/build-android.sh --install            # install the APK on a connected device / emulator
#
# Requirements: scripts/check-prereqs.sh.
# Output: android/app/build/outputs/apk/<variant>/ and dist/android/.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT/android"

VARIANT=Release
VARIANT_LC=release
ABIS=()
WITH_MODELS=0
SKIP_NATIVE=0
BUNDLE=0
INSTALL=0
GRADLE_TASK="assembleRelease"

while [ $# -gt 0 ]; do
  case "$1" in
    --debug)   VARIANT=Debug; VARIANT_LC=debug; GRADLE_TASK="assembleDebug" ;;
    --release) VARIANT=Release; VARIANT_LC=release; GRADLE_TASK="assembleRelease" ;;
    --abi)     shift; ABIS+=("$1") ;;
    --with-models) WITH_MODELS=1 ;;
    --skip-native) SKIP_NATIVE=1 ;;
    --bundle)  BUNDLE=1 ;;
    --install) INSTALL=1 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\n==> %s\n' "$*"; }

say "Checking prerequisites"
if ! "$ROOT/scripts/check-prereqs.sh"; then
  echo
  echo "Fix the missing requirements above, then run this script again."
  exit 1
fi

if [ ! -x "$ANDROID_DIR/gradlew" ]; then
  say "Making gradlew executable"
  chmod +x "$ANDROID_DIR/gradlew"
fi

# --- models (optional, but the app needs them for high-quality removal) ------
if [ "$WITH_MODELS" -eq 1 ]; then
  say "Downloading the background-removal models"
  "$ROOT/scripts/fetch-models.sh" --tier quick
  echo "The balanced and high-quality models are 224 MB and 973 MB:"
  echo "  scripts/fetch-models.sh --tier balanced"
  echo "  scripts/fetch-models.sh --tier hq"
fi

# --- gradle arguments ---------------------------------------------------------
GRADLE_ARGS=()
if [ ${#ABIS[@]} -gt 0 ]; then
  GRADLE_ARGS+=("-Pphotocraft.abis=$(IFS=,; echo "${ABIS[*]}")")
fi
if [ "$SKIP_NATIVE" -eq 1 ]; then
  GRADLE_ARGS+=("-Pphotocraft.skipNative=true")
fi
if [ "$VARIANT" = "Debug" ]; then
  GRADLE_ARGS+=("-Pphotocraft.cargoProfile=debug")
fi

say "Building the Rust engine and the $VARIANT APK"
printf '    gradle task : %s\n' "$GRADLE_TASK"
printf '    abis        : %s\n' "${ABIS[*]:-arm64-v8a,armeabi-v7a,x86_64 (default)}"
printf '    profile     : %s\n' "$([ "$VARIANT" = "Debug" ] && echo debug || echo release)"
( cd "$ANDROID_DIR" && ./gradlew --no-daemon --stacktrace "${GRADLE_ARGS[@]}" ":app:$GRADLE_TASK" )

if [ "$BUNDLE" -eq 1 ]; then
  say "Building the release bundle (.aab)"
  ( cd "$ANDROID_DIR" && ./gradlew --no-daemon "${GRADLE_ARGS[@]}" ":app:bundleRelease" )
fi

# --- collect the artifacts ----------------------------------------------------
say "Collecting the artifacts"
OUT="$ROOT/dist/android"
mkdir -p "$OUT"
FOUND=0
while IFS= read -r apk; do
  cp -f "$apk" "$OUT/"
  echo "  $(basename "$apk")  ($(du -h "$apk" | cut -f1)B)"
  FOUND=1
  if [ "$INSTALL" -eq 1 ]; then
    if command -v adb >/dev/null 2>&1; then
      echo "  installing on the connected device…"
      adb install -r "$apk" || echo "  adb install failed (is a device connected?)"
    else
      echo "  adb is not on PATH — skipping the install"
    fi
  fi
done < <(find "$ANDROID_DIR/app/build/outputs" -name '*.apk' -o -name '*.aab' 2>/dev/null | sort)

if [ "$FOUND" -eq 0 ]; then
  echo "No APK was produced — check the Gradle output above." >&2
  exit 1
fi

say "Done"
echo "  artifacts: $OUT"
echo "  engine   : android/app/src/main/jniLibs/<abi>/libphotocraft.so"
echo
echo "To verify the engine on a device:"
echo "  adb logcat | grep photocraft"
