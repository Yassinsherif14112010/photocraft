#!/usr/bin/env python3
"""
Android resource guard.

It catches the mistakes that only surface at build time (or, worse, at runtime on one
configuration) rather than while writing the code:

 1. a layout, menu, drawable or Kotlin file referencing a **string** that is not defined in
    `res/values/strings.xml`;
 2. `res/values-ar/strings.xml` and `res/values/strings.xml` not defining the same keys — a missing
    Arabic key silently falls back to English at runtime and breaks the RTL promise;
 3. a duplicate string key;
 4. a reference to a resource that does not exist (`@dimen/x`, `@color/x`, `@drawable/x`,
    `@integer/x`, `@style/x`, `@menu/x`, `@layout/x`, `R.color.x`, …);
 5. XML that is not well-formed.

Framework and library resources (`android.R.*`, `Widget.MaterialComponents.*`,
`appbar_scrolling_view_behavior`, …) are allow-listed, and Kotlin's `R.style.A_B` is matched against
the dotted `A.B` name declared in XML.

It also reports unreferenced string keys so the file does not accumulate dead entries.

Usage:
    python3 tools/check_resources.py [--root .] [--strict]

Exit code 0 when everything is consistent, 1 otherwise.
"""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

APP = Path("android/app/src/main")
STRINGS = "res/values/strings.xml"
STRINGS_AR = "res/values-ar/strings.xml"

# `@string/foo` in XML, and R.string.foo / getString(R.string.foo) in Kotlin.
XML_REF = re.compile(r'"@(string|drawable|mipmap|color|dimen|integer|style|menu|layout|xml)/([A-Za-z0-9_.]+)"')
KT_REF = re.compile(r"R\.(string|drawable|mipmap|color|dimen|integer|style|menu|layout|xml)\.([A-Za-z0-9_]+)")
DEF = re.compile(r'<(?:string|plurals)\s+name="([A-Za-z0-9_.]+)"')

# Resources that ship with the platform or with AndroidX / Material, not with this app.
EXTERNAL = {
    ("string", "appbar_scrolling_view_behavior"),
    ("string", "bottom_sheet_behavior"),
    ("string", "clear_text_end_icon_content_description"),
    ("string", "copy_toast_msg"),
    ("string", "default_error_message"),
    ("string", "error_icon_content_description"),
    ("string", "icon_content_description"),
    ("string", "mtrl_picker_date_header_title"),
    ("string", "password_toggle_content_description"),
    ("string", "search_menu_title"),
    ("string", "searchview_description"),
    ("layout", "simple_spinner_dropdown_item"),
    ("layout", "simple_spinner_item"),
    ("layout", "simple_list_item_1"),
}

# Prefixes of names that belong to the platform or a library.
EXTERNAL_PREFIXES = (
    ("style", "Widget.MaterialComponents."),
    ("style", "TextAppearance.MaterialComponents."),
    ("style", "Widget.AppCompat."),
    ("style", "TextAppearance.AppCompat."),
    ("style", "Widget.Design."),
    ("style", "Theme.MaterialComponents."),
    ("style", "Theme.Material3."),
    ("style", "Base."),
    ("dimen", "abc_"),
    ("dimen", "design_"),
    ("dimen", "mtrl_"),
    ("dimen", "material_"),
    ("color", "abc_"),
    ("color", "design_"),
    ("color", "mtrl_"),
    ("color", "material_"),
    ("drawable", "abc_"),
    ("drawable", "design_"),
    ("drawable", "mtrl_"),
)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def string_keys(path: Path) -> tuple[set[str], list[str]]:
    """Returns (keys, duplicate keys) declared in a strings file."""
    if not path.is_file():
        return set(), []
    keys = DEF.findall(read(path))
    seen: set[str] = set()
    duplicates: list[str] = []
    for key in keys:
        if key in seen:
            duplicates.append(key)
        seen.add(key)
    return seen, duplicates


def declared_resources(app: Path) -> dict[str, set[str]]:
    """Every resource name this app defines, by type."""
    res = app / "res"
    declared: dict[str, set[str]] = {k: set() for k in
                                     ("string", "drawable", "mipmap", "color", "dimen",
                                      "integer", "style", "menu", "layout", "xml")}
    if not res.is_dir():
        return declared

    for directory in res.iterdir():
        if not directory.is_dir():
            continue
        for file in directory.rglob("*"):
            if not file.is_file():
                continue
            if directory.name.startswith("values"):
                tag_type = {
                    "string": "string",
                    "plurals": "string",
                    "color": "color",
                    "dimen": "dimen",
                    "integer": "integer",
                    "integer-array": "integer",
                    "style": "style",
                }
                try:
                    root = ET.parse(file).getroot()
                except ET.ParseError:
                    continue
                for element in root:
                    kind = tag_type.get(element.tag)
                    name = element.get("name")
                    if kind and name:
                        declared[kind].add(name)
            elif directory.name.startswith(("drawable", "mipmap", "menu", "layout", "xml")):
                kind = re.sub(r"-.*$", "", directory.name)  # drawable-night → drawable
                if kind in declared:
                    declared[kind].add(file.stem)
    return declared


def collect_references(app: Path) -> tuple[dict[tuple[str, str], set[str]], list[str]]:
    """Returns ({(type, name): {files}}, malformed xml files)."""
    refs: dict[tuple[str, str], set[str]] = {}
    malformed: list[str] = []
    root = app.parents[2]  # repository root (…/android/app/src/main → …)

    files = sorted(app.rglob("*.xml")) + sorted((app / "kotlin").rglob("*.kt"))
    for file in files:
        relative = str(file.relative_to(root))
        text = read(file)
        if file.suffix == ".xml":
            try:
                ET.parse(file)
            except ET.ParseError as exc:
                malformed.append(f"{relative}: {exc}")
            for kind, name in XML_REF.findall(text):
                refs.setdefault((kind, name), set()).add(relative)
        else:
            for kind, name in KT_REF.findall(text):
                # Kotlin writes dots as underscores (R.style.Text_PhotoCraft).
                refs.setdefault((kind, name), set()).add(relative)
    return refs, malformed


def resolves(kind: str, name: str, declared: dict[str, set[str]]) -> bool:
    if (kind, name) in EXTERNAL:
        return True
    if any(kind == k and name.startswith(prefix) for k, prefix in EXTERNAL_PREFIXES):
        return True
    if name in declared.get(kind, set()):
        return True
    # R.style.A_B in Kotlin vs "A.B" in XML.
    if kind == "style":
        for candidate in declared.get("style", set()):
            if candidate.replace(".", "_") == name:
                return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="repository root")
    parser.add_argument("--strict", action="store_true", help="fail on unreferenced string keys too")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    app = root / APP
    if not app.is_dir():
        print(f"no Android module at {app} — nothing to check")
        return 0

    en_path = app / STRINGS
    ar_path = app / STRINGS_AR
    if not en_path.is_file():
        print(f"missing {STRINGS} — nothing to check")
        return 1

    problems: list[str] = []

    en, en_dupes = string_keys(en_path)
    ar, ar_dupes = string_keys(ar_path)
    for key in en_dupes:
        problems.append(f"duplicate key in {STRINGS}: {key}")
    for key in ar_dupes:
        problems.append(f"duplicate key in {STRINGS_AR}: {key}")
    for key in sorted(en - ar):
        problems.append(f"missing Arabic translation: {key}")
    for key in sorted(ar - en):
        problems.append(f"{STRINGS_AR} defines {key}, which English does not")

    declared = declared_resources(app)
    refs, malformed = collect_references(app)
    for item in malformed:
        problems.append(f"malformed XML: {item}")

    string_refs = {name for (kind, name) in refs if kind == "string" and (kind, name) not in EXTERNAL}
    for key in sorted(string_refs - en):
        where = ", ".join(sorted(refs[("string", key)])[:3])
        problems.append(f"undefined string '{key}' referenced from {where}")

    for (kind, name), where in sorted(refs.items()):
        if kind == "string":
            continue
        if not resolves(kind, name, declared):
            problems.append(
                f"undefined {kind} '{name}' referenced from {', '.join(sorted(where)[:3])}"
            )

    unused = sorted(en - string_refs)

    print(f"strings (en): {len(en)}   strings (ar): {len(ar)}   "
          f"referenced strings: {len(string_refs)}   other resources checked: "
          f"{len([r for r in refs if r[0] != 'string'])}")
    if unused:
        print(f"unreferenced string keys: {len(unused)}")
        for key in unused[:40]:
            print(f"  - {key}")
        if len(unused) > 40:
            print(f"  … and {len(unused) - 40} more")

    if problems:
        print(f"\n{len(problems)} problem(s):")
        for problem in problems:
            print(f"  x {problem}")
        return 1

    if args.strict and unused:
        print("\n--strict: unreferenced keys are treated as failures")
        return 1

    print("OK resources are consistent: en/ar key sets match and every reference resolves")
    return 0


if __name__ == "__main__":
    sys.exit(main())
