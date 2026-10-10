#!/usr/bin/env bash
# PhotoCraft — repository guard tests.
#
# These are the checks that need no Android SDK, no JDK and no Rust toolchain: they run on any
# machine with bash and python3, and they are the ones that catch the mistakes that would only show
# up much later (a missing Arabic string, a JNI symbol that drifted from its Kotlin declaration, a
# model manifest that disagrees with the copy the app ships, a shell script that cannot be parsed).
#
# When a toolchain IS present, the corresponding section runs too; otherwise it is reported as
# SKIPPED — never as a pass.
#
# Usage:
#   tests/test_tools.sh            # run everything that this machine can run
#   tests/test_tools.sh --quick    # skip tests/test_fetch_models.sh (the network fixture test)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUICK=0
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

PASSED=0
FAILED=0
SKIPPED=0

ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASSED=$((PASSED + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf '  \033[33mSKIP\033[0m %s (%s)\n' "$1" "$2"; SKIPPED=$((SKIPPED + 1)); }

check() { # description, command...
  local desc="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    ok "$desc"
    [ -n "${VERBOSE:-}" ] && printf '%s\n' "$out" | sed 's/^/       /'
  else
    bad "$desc"
    printf '%s\n' "$out" | sed 's/^/       /'
  fi
}

echo "PhotoCraft — repository guard tests"
echo "  repository: $ROOT"
echo

# ---------------------------------------------------------------------------
echo "Shell scripts parse"
shopt -s nullglob
for script in scripts/*.sh tests/*.sh; do
  if bash -n "$script"; then ok "bash -n $script"; else bad "bash -n $script"; fi
done
shopt -u nullglob
echo

# ---------------------------------------------------------------------------
echo "Python tools compile"
for tool in tools/*.py; do
  if python3 -m py_compile "$tool"; then ok "py_compile $tool"; else bad "py_compile $tool"; fi
done
echo

# ---------------------------------------------------------------------------
echo "In-repo consistency checks"
check "resources: en/ar key sets match and every reference resolves" python3 tools/check_resources.py
check "models.conf: manifest valid and the app asset is byte-identical" python3 tools/check_models_conf.py
check "JNI: every external fun has a matching Rust symbol" python3 tools/check_jni_symbols.py
echo

# ---------------------------------------------------------------------------
echo "Model downloader (real integration test)"
if [ "$QUICK" -eq 1 ]; then
  skip "tests/test_fetch_models.sh" "--quick"
elif command -v curl >/dev/null 2>&1 && command -v sha256sum >/dev/null 2>&1; then
  if bash tests/test_fetch_models.sh >/tmp/photocraft_fetch_models.log 2>&1; then
    summary="$(sed 's/\x1b\[[0-9;]*m//g' /tmp/photocraft_fetch_models.log | sed -n 's/^[[:space:]]*\([0-9][0-9]*\) passed, \([0-9][0-9]*\) failed.*/\1 assertions, \2 failed/p' | tail -n1)"
    ok "tests/test_fetch_models.sh (${summary:-see /tmp/photocraft_fetch_models.log})"
  else
    bad "tests/test_fetch_models.sh"
    tail -n 25 /tmp/photocraft_fetch_models.log | sed 's/^/       /'
  fi
else
  skip "tests/test_fetch_models.sh" "needs curl and sha256sum"
fi
echo

# ---------------------------------------------------------------------------
echo "Rust workspace (crates/)"
if command -v cargo >/dev/null 2>&1; then
  check "cargo test --workspace" cargo test --workspace --quiet
  check "cargo clippy --workspace" cargo clippy --workspace --quiet -- -D warnings
else
  skip "cargo test --workspace" "cargo is not installed on this machine"
  skip "cargo clippy --workspace" "cargo is not installed on this machine"
fi
echo

# ---------------------------------------------------------------------------
echo "Android module"
if command -v java >/dev/null 2>&1 && [ -d "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/nonexistent}}" ]; then
  check "gradle :app:assembleDebug" bash -c 'cd android && ./gradlew --no-daemon :app:assembleDebug'
else
  skip "gradle :app:assembleDebug" "no JDK 17+ or no Android SDK on this machine"
fi
echo

# ---------------------------------------------------------------------------
printf 'Result: %d passed, %d failed, %d skipped\n' "$PASSED" "$FAILED" "$SKIPPED"
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
