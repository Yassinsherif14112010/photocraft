#!/usr/bin/env python3
"""
Model manifest guard.

`scripts/models.conf` is the single source of truth for the background-removal models: the
download scripts read it on the development machine and the Android app bundles the *same* file as
`android/app/src/main/assets/models.conf`. If the two drift apart, the app would download a file
under one name/checksum and look for another, so this check must fail.

It also validates the manifest itself:

  * exactly 10 fields per model line;
  * https URLs only;
  * `bytes` > 0 ⇒ `min_bytes` <= `bytes` (a floor above the real size would reject every download);
  * a `sha256` is either '-' or 64 lowercase hex characters;
  * ids, tiers and file names are unique and usable as file names.

Usage:
    python3 tools/check_models_conf.py [--root .]

Exit code 0 when the manifest is valid and both copies agree, 1 otherwise.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

MANIFEST = Path("scripts/models.conf")
ASSET = Path("android/app/src/main/assets/models.conf")

FIELDS = 10
HEX64 = re.compile(r"^[0-9a-f]{64}$")
TIERS = {"quick", "balanced", "hq"}
SAFE_FILE = re.compile(r"^[A-Za-z0-9._-]+$")


def parse(text: str) -> list[tuple[int, list[str]]]:
    rows: list[tuple[int, list[str]]] = []
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        rows.append((number, [f.strip() for f in stripped.split("|")]))
    return rows


def validate(rows: list[tuple[int, list[str]]]) -> list[str]:
    problems: list[str] = []
    seen_ids: dict[str, int] = {}
    seen_files: dict[str, int] = {}
    tiers_seen: set[str] = set()

    for number, fields in rows:
        if len(fields) != FIELDS:
            problems.append(f"line {number}: {len(fields)} fields, expected {FIELDS}")
            continue
        model_id, label, tier, size, file_name, size_bytes, sha, floor, url, mirrors = fields

        if model_id in seen_ids:
            problems.append(f"line {number}: duplicate id '{model_id}' (first seen on line {seen_ids[model_id]})")
        seen_ids[model_id] = number

        if not label:
            problems.append(f"line {number}: empty label")

        if tier not in TIERS:
            problems.append(f"line {number}: tier '{tier}' is not one of {sorted(TIERS)}")
        elif tier in tiers_seen:
            problems.append(f"line {number}: a second model already declares the tier '{tier}'")
        else:
            tiers_seen.add(tier)

        if not size.isdigit() or not (64 <= int(size) <= 4096):
            problems.append(f"line {number}: input size '{size}' is not a sane pixel size")

        if not SAFE_FILE.match(file_name):
            problems.append(f"line {number}: file name '{file_name}' is not usable as a file name")
        if file_name in seen_files:
            problems.append(f"line {number}: duplicate file name '{file_name}'")
        seen_files[file_name] = number

        size_bytes_value = int(size_bytes) if size_bytes.isdigit() else -1
        if size_bytes_value < 0:
            problems.append(f"line {number}: bytes '{size_bytes}' is not a number")

        if sha != "-" and not HEX64.match(sha):
            problems.append(f"line {number}: sha256 is neither '-' nor 64 lowercase hex characters")

        floor_value = int(floor) if floor.isdigit() else -1
        if floor_value < 0:
            problems.append(f"line {number}: min_bytes '{floor}' is not a number")
        elif size_bytes_value > 0 and floor_value > size_bytes_value:
            problems.append(
                f"line {number}: min_bytes {floor_value} is larger than the real size "
                f"{size_bytes_value} — every download would be rejected"
            )

        for source in [url] + [m for m in mirrors.split(";") if m and m != "-"]:
            if not source.startswith("https://"):
                problems.append(f"line {number}: '{source}' is not an https URL")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="repository root")
    args = parser.parse_args()
    root = Path(args.root).resolve()

    manifest = root / MANIFEST
    asset = root / ASSET
    if not manifest.is_file():
        print(f"missing {MANIFEST}")
        return 1

    text = manifest.read_text(encoding="utf-8")
    rows = parse(text)
    if not rows:
        print(f"{MANIFEST} declares no models")
        return 1

    problems = validate(rows)

    if not asset.is_file():
        problems.append(
            f"missing {ASSET}: run `cp {MANIFEST} {ASSET}` so the app ships the same manifest"
        )
    elif asset.read_bytes() != manifest.read_bytes():
        problems.append(
            f"{ASSET} and {MANIFEST} differ — copy the manifest over the asset "
            f"(cp {MANIFEST} {ASSET})"
        )

    print(f"models declared: {len(rows)}")
    for _, fields in rows:
        size = int(fields[5]) if fields[5].isdigit() else 0
        print(f"  - {fields[0]:18s} {fields[2]:9s} {fields[4]:52s} "
              f"{size / 1_000_000:8.1f} MB  {fields[8]}")

    if problems:
        print(f"\n{len(problems)} problem(s):")
        for problem in problems:
            print(f"  x {problem}")
        return 1

    print("OK the manifest is valid and the app asset is byte-identical")
    return 0


if __name__ == "__main__":
    sys.exit(main())
