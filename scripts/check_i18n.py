#!/usr/bin/env python3
"""
check_i18n.py — prove that every `s.section.key` string referenced from the
TS/TSX layer exists in BOTH locale files (en.ts, ar.ts). Exits non-zero on
any missing key, so a missing label can never ship as `undefined` in the UI.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

SECTION_OPEN = re.compile(r"^  ([a-zA-Z][a-zA-Z0-9]*): \{(.*)$")
KEY_LINE = re.compile(r"^    ([a-zA-Z][a-zA-Z0-9]*):")
SECTION_CLOSE = re.compile(r"^  \},")

def load_section_keys(path: Path) -> set:
    keys = set()
    lines = path.read_text(encoding="utf-8").splitlines()
    i = 0
    while i < len(lines):
        m = SECTION_OPEN.match(lines[i])
        if not m:
            i += 1
            continue
        section, rest = m.group(1), m.group(2).strip()
        if rest.endswith("},"):
            # single-line section:  theme: {dark: 'Dark', …},
            for k in re.findall(r"([a-zA-Z][a-zA-Z0-9]*):", rest):
                keys.add(f"{section}.{k}")
            i += 1
            continue
        # multi-line section: collect 4-space keys until the 2-space `},`
        i += 1
        while i < len(lines) and not SECTION_CLOSE.match(lines[i]):
            km = KEY_LINE.match(lines[i])
            if km:
                keys.add(f"{section}.{km.group(1)}")
            i += 1
        i += 1  # skip the closing `},`
    return keys

def ts_used_keys() -> set:
    used = set()
    for p in SRC.rglob("*.ts*"):
        if p.name.startswith("i18n"):
            continue
        text = p.read_text(encoding="utf-8")
        used |= set(re.findall(r"\bs\.([a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*)\b", text))
    return used

def main() -> int:
    en = load_section_keys(SRC / "i18n" / "en.ts")
    ar = load_section_keys(SRC / "i18n" / "ar.ts")
    used = ts_used_keys()
    missing_en = sorted(k for k in used if k not in en)
    missing_ar = sorted(k for k in used if k not in ar)
    print(f"used keys      : {len(used)}")
    print(f"en keys        : {len(en)}")
    print(f"ar keys        : {len(ar)}")
    if missing_en:
        print("MISSING in en.ts:")
        for k in missing_en:
            print(f"  - {k}")
    if missing_ar:
        print("MISSING in ar.ts:")
        for k in missing_ar:
            print(f"  - {k}")
    if missing_en or missing_ar:
        return 1
    print("OK — every key used in TS exists in both locales")
    return 0

if __name__ == "__main__":
    sys.exit(main())
