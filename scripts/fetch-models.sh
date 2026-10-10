#!/usr/bin/env bash
#
# PhotoCraft — download and verify the local background-removal models.
#
# Reads scripts/models.conf, downloads each model to its destination and verifies it:
#   * HTTP status is checked (redirects are followed; a 404/403 is a hard failure),
#   * a partial download is resumed (HTTP Range) and retried,
#   * the exact byte size is checked when the distributor publishes one,
#   * the SHA-256 is checked when the distributor publishes one,
#   * anything smaller than the manifest's sanity floor is rejected (an HTML error page is not a model),
#   * a model that is already present and valid is left alone (no needless re-download),
#   * every failure prints why and exits non-zero: the script never reports success with a
#     missing or corrupt model.
#
# Usage:
#   scripts/fetch-models.sh [--dest DIR] [--manifest FILE] [--only id,id] [--tier quick|balanced|hq]
#                           [--verify] [--force] [--retries N] [--bundle] [-h]
#
# Environment:
#   PHOTOCRAFT_MODELS_DIR   default destination (overridden by --dest)
#
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)"
MANIFEST="$REPO_ROOT/scripts/models.conf"
DEST="${PHOTOCRAFT_MODELS_DIR:-$REPO_ROOT/android/models}"
ONLY=""
TIER=""
VERIFY=0
FORCE=0
RETRIES=3
BUNDLE=0

usage() {
    sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
}

die() { printf 'fetch-models: %s\n' "$*" >&2; exit 1; }
info() { printf '  %s\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }

while [ $# -gt 0 ]; do
    case "$1" in
        --dest) DEST="${2:-}"; shift 2 || die "--dest needs a directory" ;;
        --manifest) MANIFEST="${2:-}"; shift 2 || die "--manifest needs a file" ;;
        --only) ONLY="${2:-}"; shift 2 || die "--only needs a comma-separated id list" ;;
        --tier) TIER="${2:-}"; shift 2 || die "--tier needs quick|balanced|hq" ;;
        --verify) VERIFY=1; shift ;;
        --force) FORCE=1; shift ;;
        --retries) RETRIES="${2:-3}"; shift 2 || die "--retries needs a number" ;;
        --bundle) BUNDLE=1; shift ;;
        -h|--help) usage ;;
        *) die "unknown argument: $1 (try --help)" ;;
    esac
done

[ -r "$MANIFEST" ] || die "manifest not found: $MANIFEST"
command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || die "neither curl nor wget is installed"

HAS_CURL=0
command -v curl >/dev/null 2>&1 && HAS_CURL=1

# --- helpers -----------------------------------------------------------------

file_size() { # file
    if [ -f "$1" ]; then
        wc -c < "$1" | tr -d ' \n'
    else
        echo 0
    fi
}

sha256_of() { # file -> lowercase hex, empty when no SHA-256 tool exists
    local f="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$f" 2>/dev/null | awk '{print tolower($1)}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$f" 2>/dev/null | awk '{print tolower($1)}'
    elif command -v openssl >/dev/null 2>&1; then
        openssl dgst -sha256 -r "$f" 2>/dev/null | awk '{print tolower($1)}'
    else
        echo ""
    fi
}

# download URL DEST_PART -> prints the HTTP status code (000 on a transport failure)
download_once() {
    local url="$1" part="$2" code
    if [ "$HAS_CURL" = 1 ]; then
        code=$(curl -L -C - --retry 2 --retry-delay 1 --connect-timeout 20 \
            -o "$part" -w '%{http_code}' -sS "$url" 2>/dev/null) || code=000
    else
        # wget appends to an existing file (-c): the same resume behaviour.
        code=$(wget -c -q -O "$part" --tries=2 --timeout=20 --server-response "$url" 2>&1 \
            | awk '/^ *HTTP/{c=$2} END{print c}')
        if [ -s "$part" ] && [ -z "$code" ]; then code=200; fi
    fi
    echo "${code:-000}"
}

# inspect FILE EXPECTED_BYTES EXPECTED_SHA MIN_BYTES
# Prints nothing and returns 0 when the file is good; prints the reason and returns 1 otherwise.
inspect() {
    local f="$1" bytes="$2" sha="$3" min="$4" size actual
    if [ ! -f "$f" ]; then
        echo "the file is missing"
        return 1
    fi
    size=$(file_size "$f")
    if [ -n "$min" ] && [ "$min" -gt 0 ] 2>/dev/null && [ "$size" -lt "$min" ]; then
        echo "only $size bytes, expected at least $min — truncated download or an error page"
        return 1
    fi
    if [ -n "$bytes" ] && [ "$bytes" -gt 0 ] 2>/dev/null && [ "$size" -ne "$bytes" ]; then
        echo "size $size, expected $bytes"
        return 1
    fi
    if [ -n "$sha" ] && [ "$sha" != "-" ]; then
        actual=$(sha256_of "$f")
        if [ -z "$actual" ]; then
            echo "" # no SHA-256 tool: size was checked, that is all we can do
        elif [ "$actual" != "$(printf '%s' "$sha" | tr 'A-Z' 'a-z')" ]; then
            echo "checksum $actual, expected $sha"
            return 1
        fi
    fi
    return 0
}

verify_file() { # id file bytes sha min -> prints the outcome, returns 0 when good
    local id="$1" f="$2" bytes="$3" sha="$4" min="$5" size reason
    reason=$(inspect "$f" "$bytes" "$sha" "$min")
    if [ -n "$reason" ]; then
        fail "$id: $reason"
        return 1
    fi
    size=$(file_size "$f")
    ok "$id: $(basename "$f") ($size bytes) verified"
    return 0
}

fetch_model() { # id label file bytes sha min url mirrors
    local id="$1" label="$2" file="$3" bytes="$4" sha="$5" min="$6" url="$7" mirrors="$8"
    local target="$DEST/$file"

    if [ "$VERIFY" = 1 ]; then
        verify_file "$id" "$target" "$bytes" "$sha" "$min" && return 0 || return 1
    fi

    if [ "$FORCE" = 0 ] && inspect "$target" "$bytes" "$sha" "$min" >/dev/null 2>&1; then
        ok "$id: already present and valid — skipping the download (use --force to replace it)"
        return 0
    fi

    local candidates="$url"
    if [ -n "$mirrors" ] && [ "$mirrors" != "-" ]; then
        candidates="$candidates $mirrors"
    fi
    candidates=$(printf '%s' "$candidates" | tr ';' ' ')

    local part="$target.part"
    local candidate success=1 code="" attempt reason=""
    for candidate in $candidates; do
        attempt=1
        while [ "$attempt" -le "$RETRIES" ]; do
            info "$id: downloading $label from ${candidate%%\?*} (attempt $attempt/$RETRIES)"
            code=$(download_once "$candidate" "$part")
            case "$code" in
                200|206) : ;;
                000) warn "$id: network error (no HTTP status) on attempt $attempt" ;;
                *) warn "$id: HTTP $code from $candidate" ;;
            esac
            # Keep the verifier's explanation: a silent "failed" is impossible to act on.
            reason=$(inspect "$part" "$bytes" "$sha" "$min")
            if { [ "$code" = "200" ] || [ "$code" = "206" ]; } && [ -z "$reason" ]; then
                success=0
                break
            fi
            [ -n "$reason" ] && warn "$id: $reason"
            attempt=$((attempt + 1))
            # Keep a too-small download aside instead of resuming it: a 2 KB "model" is an HTML
            # error page, and appending to it would only hide the cause.
            if [ -n "$min" ] && [ "$min" -gt 0 ] 2>/dev/null && [ "$(file_size "$part")" -lt "$min" ]; then
                mv -f "$part" "$part.rejected" 2>/dev/null || true
            fi
            sleep 2
        done
        [ "$success" = 0 ] && break
        warn "$id: giving up on $candidate"
        rm -f "$part"
    done

    if [ "$success" != 0 ]; then
        if [ -z "$reason" ] && [ -f "$part.rejected" ]; then
            reason=$(inspect "$part.rejected" "$bytes" "$sha" "$min")
        fi
        if [ -n "$reason" ]; then
            fail "$id: the downloaded copy did not verify — $reason"
        else
            fail "$id: no data was written (last HTTP status: ${code:-none})"
        fi
        fail "$id: could not download a valid copy from any source"
        rm -f "$part" "$part.rejected"
        return 1
    fi

    mv -f "$part" "$target" || return 1
    rm -f "$part.rejected"
    verify_file "$id" "$target" "$bytes" "$sha" "$min"
}

# --- main --------------------------------------------------------------------

if [ "$VERIFY" = 0 ]; then
    mkdir -p "$DEST" || die "cannot create $DEST"
fi

printf 'PhotoCraft model acquisition\n'
printf '  manifest : %s\n' "$MANIFEST"
printf '  target   : %s\n' "$DEST"
printf '  mode     : %s\n\n' "$([ "$VERIFY" = 1 ] && echo verify || echo download)"

SELECTED=0
MISSING=0

while IFS= read -r line; do
    case "$line" in
        ''|'#'*) continue ;;
    esac
    IFS='|' read -r id label tier input file bytes sha min url mirrors <<<"$line"
    id="$(printf '%s' "$id" | tr -d ' ')"
    [ -z "$id" ] && continue
    if [ -n "$TIER" ] && [ "$tier" != "$TIER" ]; then continue; fi
    if [ -n "$ONLY" ]; then
        case ",$ONLY," in
            *",$id,"*) : ;;
            *) continue ;;
        esac
    fi
    SELECTED=$((SELECTED + 1))
    fetch_model "$id" "$label" "$file" "${bytes:-0}" "${sha:--}" "${min:-0}" "$url" "${mirrors:-}" || MISSING=$((MISSING + 1))
    echo
done < "$MANIFEST"

if [ "$SELECTED" = 0 ]; then
    die "no model in $MANIFEST matches --tier='$TIER' --only='$ONLY'"
fi

if [ "$MISSING" -gt 0 ]; then
    printf '\n\033[31m%s of %s model(s) could not be fetched or verified.\033[0m\n' "$MISSING" "$SELECTED" >&2
    printf 'The app still runs: Quick Remove uses the engine'"'"'s built-in Select Subject and\n' >&2
    printf 'needs no model. High-quality removal stays unavailable until the model is present.\n' >&2
    exit 1
fi

if [ "$BUNDLE" = 1 ]; then
    ASSETS="$REPO_ROOT/android/app/src/main/assets/models"
    mkdir -p "$ASSETS" || die "cannot create $ASSETS"
    total=0
    while IFS= read -r line; do
        case "$line" in ''|'#'*) continue ;; esac
        IFS='|' read -r id label tier input file bytes sha min url mirrors <<<"$line"
        [ -f "$DEST/$file" ] || continue
        cp -f "$DEST/$file" "$ASSETS/$file" || die "cannot copy $file into the APK assets"
        total=$((total + $(file_size "$DEST/$file")))
    done < "$MANIFEST"
    printf 'Bundled into %s (%s bytes).\n' "$ASSETS" "$total"
    if [ "$total" -gt 150000000 ]; then
        warn "that is more than 150 MB of APK assets — most users should let the app download models at runtime"
    fi
fi

printf '\n\033[32mAll %s model(s) present and verified in %s\033[0m\n' "$SELECTED" "$DEST"
printf 'Install them on a device with:\n'
printf '  adb push %s/<file> /sdcard/Android/data/ai.storyteller.photocraft/files/models/\n' "$DEST"
printf 'or let the app download them itself: Editor › AI › High quality › Download model.\n'
