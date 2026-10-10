#!/usr/bin/env bash
# PhotoCraft for Android — prerequisite check.
#
# Reports what is present and what is missing, then exits non-zero if a hard requirement is not
# met. It never installs anything and never downloads anything: it only inspects the machine.
#
# Usage:
#   scripts/check-prereqs.sh            # report and exit 1 when something is missing
#   scripts/check-prereqs.sh --verbose  # also print the versions found

set -uo pipefail

VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    --verbose|-v) VERBOSE=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MISSING=0

have() { command -v "$1" >/dev/null 2>&1; }

report() { # name  status  detail
  printf '  %-22s %-8s %s\n' "$1" "$2" "$3"
}

echo "PhotoCraft for Android — prerequisites"
echo "  repository: $ROOT"
echo

# --- JDK ---------------------------------------------------------------------
JDK_DETAIL="not found"
if have java; then
  JAVA_VERSION="$(java -version 2>&1 | head -n1)"
  JDK_MAJOR="$(java -version 2>&1 | sed -n '1s/.*version "\([0-9]*\).*/\1/p')"
  JDK_DETAIL="$JAVA_VERSION"
  if [ -n "${JDK_MAJOR:-}" ] && [ "$JDK_MAJOR" -ge 17 ]; then
    report "JDK 17+" "OK" "$JDK_DETAIL"
  else
    report "JDK 17+" "MISSING" "$JDK_DETAIL (need 17 or newer)"
    MISSING=1
  fi
else
  report "JDK 17+" "MISSING" "java is not on PATH"
  MISSING=1
fi

# --- Rust --------------------------------------------------------------------
if have cargo; then
  report "cargo" "OK" "$(cargo --version 2>&1)"
  if cargo ndk --version >/dev/null 2>&1; then
    report "cargo-ndk" "OK" "$(cargo ndk --version 2>&1 | head -n1)"
  else
    report "cargo-ndk" "MISSING" "install with: cargo install cargo-ndk@4"
    MISSING=1
  fi
  # The workspace needs rust-version 1.95 (Cargo.toml).
  RUSTC_V="$(rustc --version 2>/dev/null | sed -n '1s/rustc \([0-9.]*\).*/\1/p')"
  report "rustc" "OK" "${RUSTC_V:-unknown} (workspace needs 1.95+)"
else
  report "cargo" "MISSING" "install from https://rustup.rs (needed to build the engine)"
  MISSING=1
fi

# --- Android SDK / NDK -------------------------------------------------------
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -n "$SDK" ] && [ -d "$SDK" ]; then
  report "Android SDK" "OK" "$SDK"
  NDK_DIR="$(ls -d "$SDK"/ndk/* 2>/dev/null | sort -V | tail -n1)"
  if [ -n "$NDK_DIR" ] && [ -d "$NDK_DIR" ]; then
    report "Android NDK" "OK" "$(basename "$NDK_DIR")  ($NDK_DIR)"
  else
    report "Android NDK" "MISSING" "install with: sdkmanager \"ndk;27.0.12077973\""
    MISSING=1
  fi
  if [ -d "$SDK/platforms/android-35" ]; then
    report "Android platform 35" "OK" "$SDK/platforms/android-35"
  else
    report "Android platform 35" "MISSING" "install with: sdkmanager \"platforms;android-35\""
    MISSING=1
  fi
  if [ -d "$SDK/build-tools" ] && [ -n "$(ls -d "$SDK"/build-tools/3* 2>/dev/null)" ]; then
    report "build-tools" "OK" "$(basename "$(ls -d "$SDK"/build-tools/3* | sort -V | tail -n1)")"
  else
    report "build-tools" "MISSING" "install with: sdkmanager \"build-tools;35.0.0\""
    MISSING=1
  fi
else
  report "Android SDK" "MISSING" "set ANDROID_HOME (or ANDROID_SDK_ROOT) to your SDK directory"
  MISSING=1
fi

# --- tools used by the model downloader --------------------------------------
if have curl; then report "curl" "OK" "$(curl --version | head -n1)"
else report "curl" "MISSING" "needed by scripts/fetch-models.sh"; MISSING=1; fi
if have sha256sum; then report "sha256sum" "OK" "coreutils"
else report "sha256sum" "MISSING" "needed by scripts/fetch-models.sh"; MISSING=1; fi

# --- the repository itself ----------------------------------------------------
if [ -f "$ROOT/android/app/src/main/assets/models.conf" ]; then
  report "models.conf asset" "OK" "android/app/src/main/assets/models.conf"
else
  report "models.conf asset" "MISSING" "cp scripts/models.conf android/app/src/main/assets/models.conf"
  MISSING=1
fi
if [ -f "$ROOT/android/gradlew" ]; then
  if [ -x "$ROOT/android/gradlew" ]; then
    report "gradlew" "OK" "executable"
  else
    report "gradlew" "FIXABLE" "not executable — run: chmod +x android/gradlew"
  fi
else
  report "gradlew" "MISSING" "android/gradlew is not in the repository"
  MISSING=1
fi

echo
if [ "$MISSING" -eq 0 ]; then
  echo "Everything needed to build PhotoCraft for Android is present."
  echo "Next: scripts/build-android.sh"
  exit 0
fi
echo "Some requirements are missing (see MISSING above). Install them and run this again."
exit 1
