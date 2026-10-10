#!/usr/bin/env bash
#
# Real integration test for scripts/fetch-models.sh.
#
# It serves fixture files over a local HTTP server (python3 -m http.server) and checks the
# downloader's behaviour in the situations that matter: a clean download, a skipped re-download,
# a corrupt file being repaired, a wrong checksum, a 404, a truncated file below the sanity floor,
# a resumed download, and --verify on a missing file. No external network access is required.
#
# Run: tests/test_fetch_models.sh   (or through tests/run_tests.py)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

check() { # name expected_exit
    local expected="$1" actual="$2"
    if [ "$expected" = "$actual" ]; then
        printf '  \033[32mPASS\033[0m %s\n' "$3"
        PASS=$((PASS + 1))
    else
        printf '  \033[31mFAIL\033[0m %s (expected exit %s, got %s)\n' "$3" "$expected" "$actual"
        FAIL=$((FAIL + 1))
    fi
}

contains() { # name needle file
    if grep -qF -- "$2" "$3"; then
        printf '  \033[32mPASS\033[0m %s\n' "$1"
        PASS=$((PASS + 1))
    else
        printf '  \033[31mFAIL\033[0m %s (output did not contain: %s)\n' "$1" "$2"
        FAIL=$((FAIL + 1))
    fi
}

sha() { sha256sum "$1" | awk '{print $1}'; }

# --- fixtures ----------------------------------------------------------------
mkdir -p "$WORK/serve" "$WORK/out"
head -c 200000 /dev/urandom > "$WORK/serve/quick.onnx"
head -c 100 /dev/urandom > "$WORK/serve/tiny-file.bin"
QUICK_SHA=$(sha "$WORK/serve/quick.onnx")
QUICK_SIZE=$(wc -c < "$WORK/serve/quick.onnx" | tr -d ' ')

python3 -m http.server 8731 --directory "$WORK/serve" >/dev/null 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; rm -rf "$WORK"' EXIT
for _ in $(seq 1 40); do
    curl -s -o /dev/null "http://127.0.0.1:8731/quick.onnx" && break
    sleep 0.25
done
BASE="http://127.0.0.1:8731"

printf '\nModel downloader (scripts/fetch-models.sh)\n'

# 1. a clean download with a correct size and checksum
cat > "$WORK/good.conf" <<EOF
quick|Quick|quick|320|quick.onnx|$QUICK_SIZE|$QUICK_SHA|100000|$BASE/quick.onnx|-
EOF
bash "$REPO_ROOT/scripts/fetch-models.sh" --manifest "$WORK/good.conf" --dest "$WORK/out" >"$WORK/log1" 2>&1
check 0 $? "downloads a model and verifies size + checksum"
contains "reports success" "All 1 model(s) present and verified" "$WORK/log1"
[ -f "$WORK/out/quick.onnx" ] && [ "$(sha "$WORK/out/quick.onnx")" = "$QUICK_SHA" ]
check 0 $? "the file on disk is byte-identical"

# 2. a second run does not download again
bash "$REPO_ROOT/scripts/fetch-models.sh" --manifest "$WORK/good.conf" --dest "$WORK/out" >"$WORK/log2" 2>&1
check 0 $? "a valid model is not re-downloaded"
contains "says it skipped the download" "already present and valid" "$WORK/log2"

# 3. a corrupt file is repaired
printf 'corrupt' > "$WORK/out/quick.onnx"
bash "$REPO_ROOT/scripts/fetch-models.sh" --manifest "$WORK/good.conf" --dest "$WORK/out" >"$WORK/log3" 2>&1
check 0 $? "a corrupt file is replaced"
[ "$(sha "$WORK/out/quick.onnx")" = "$QUICK_SHA" ]
check 0 $? "the repaired file is correct"

# 4. a wrong checksum in the manifest fails
cat > "$WORK/badsha.conf" <<EOF
quick|Quick|quick|320|quick.onnx|0|0000000000000000000000000000000000000000000000000000000000000000|100000|$BASE/quick.onnx|-
EOF
bash "$REPO_ROOT/scripts/fetch-models.sh" --manifest "$WORK/badsha.conf" --dest "$WORK/out2" >"$WORK/log4" 2>&1
check 1 $? "a checksum mismatch fails the script"
contains "reports the checksum mismatch" "checksum" "$WORK/log4"

# 5. a 404 fails (after the retries, with a clear error)
cat > "$WORK/missing.conf" <<EOF
quick|Quick|quick|320|nope.onnx|0|-|100000|$BASE/nope.onnx|-
EOF
bash "$REPO_ROOT/scripts/fetch-models.sh" --manifest "$WORK/missing.conf" --dest "$WORK/out3" >"$WORK/log5" 2>&1
check 1 $? "a missing file (HTTP 404) fails the script"
contains "reports HTTP 404" "HTTP 404" "$WORK/log5"

# 6. a file below the sanity floor is rejected (an HTML error page is not a model)
cat > "$WORK/truncated.conf" <<EOF
quick|Quick|quick|320|tiny.onnx|0|-|1000000|$BASE/tiny-file.bin|-
EOF
bash "$REPO_ROOT/scripts/fetch-models.sh" --manifest "$WORK/truncated.conf" --dest "$WORK/out4" >"$WORK/log6" 2>&1
check 1 $? "a file under the minimum size is rejected"
contains "explains the truncation" "truncated download or an error page" "$WORK/log6"

# 7. --verify fails on a missing file without downloading
cat > "$WORK/verify.conf" <<EOF
quick|Quick|quick|320|quick.onnx|0|$QUICK_SHA|100000|$BASE/quick.onnx|-
EOF
bash "$REPO_ROOT/scripts/fetch-models.sh" --manifest "$WORK/verify.conf" --dest "$WORK/empty" --verify >"$WORK/log7" 2>&1
check 1 $? "--verify fails when the model is missing"
contains "--verify names the missing file" "missing" "$WORK/log7"

# 8. --verify passes on a good copy
bash "$REPO_ROOT/scripts/fetch-models.sh" --manifest "$WORK/verify.conf" --dest "$WORK/out" --verify >"$WORK/log8" 2>&1
check 0 $? "--verify passes on a good copy"

# 9. a resumed download: seed a partial file, the Range request must complete it
mkdir -p "$WORK/out5"
head -c 50000 "$WORK/serve/quick.onnx" > "$WORK/out5/quick.onnx.part"
bash "$REPO_ROOT/scripts/fetch-models.sh" --manifest "$WORK/good.conf" --dest "$WORK/out5" >"$WORK/log9" 2>&1
check 0 $? "resumes a partial download"
[ -f "$WORK/out5/quick.onnx" ] && [ "$(sha "$WORK/out5/quick.onnx")" = "$QUICK_SHA" ]
check 0 $? "the resumed file is complete and correct"

# 10. an empty selection is an error, not a silent success
bash "$REPO_ROOT/scripts/fetch-models.sh" --manifest "$WORK/good.conf" --dest "$WORK/out" --tier nosuchtier >"$WORK/log10" 2>&1
check 1 $? "an empty selection fails"

# 11. the shipped manifest is well formed and points at real https URLs
if [ -f "$REPO_ROOT/scripts/models.conf" ]; then
    bad=$(grep -v '^#' "$REPO_ROOT/scripts/models.conf" | grep -v '^$' | awk -F'|' 'NF!=10 {print $1}')
    [ -z "$bad" ]
    check 0 $? "the shipped manifest has exactly 10 fields on every line"
    nonhttps=$(grep -v '^#' "$REPO_ROOT/scripts/models.conf" | grep -v '^$' | awk -F'|' '$9 !~ /^https:\/\// {print $1}')
    [ -z "$nonhttps" ]
    check 0 $? "every model URL is https"
    ids=$(grep -v '^#' "$REPO_ROOT/scripts/models.conf" | grep -v '^$' | cut -d'|' -f1)
    [ "$ids" = "u2netp
birefnet-tiny
birefnet-general" ]
    check 0 $? "the shipped manifest lists the three expected models"
fi

kill $SERVER_PID 2>/dev/null
printf '\n  %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
