#!/usr/bin/env python3
"""
JNI bridge guard.

The Kotlin side (`android/app/src/main/kotlin/ai/storyteller/photocraft/core/NativeBridge.kt`)
declares `external fun nativeX`; the Rust side (`android/jni-rust/src/lib.rs`) must export exactly
one `Java_ai_storyteller_photocraft_core_NativeBridge_nativeX` per declaration, `#[no_mangle]` and
`extern "system"`. A typo in either file is not a compile error — it is a
`java.lang.UnsatisfiedLinkError` on the device, at the moment the user first taps a tool.

This check compares the two lists before that happens:

  * every `external fun` has a matching exported symbol;
  * every exported symbol is declared in Kotlin (no dead Rust entry points);
  * each exported symbol is `#[no_mangle]` and `extern "system"`;
  * the package in the symbol matches the Kotlin file's package.

Usage:
    python3 tools/check_jni_symbols.py [--root .]

Exit code 0 when the bridge matches on both sides, 1 otherwise.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

KOTLIN = Path("android/app/src/main/kotlin/ai/storyteller/photocraft/core/NativeBridge.kt")
RUST = Path("android/jni-rust/src/lib.rs")

PACKAGE_RE = re.compile(r"^package\s+([\w.]+)", re.M)
EXTERNAL_RE = re.compile(r"external\s+fun\s+(\w+)")
SYMBOL_RE = re.compile(
    r'#\[no_mangle\]\s*pub\s+extern\s+"system"\s+fn\s+(Java_[\w]+)',
    re.M,
)
WEAK_SYMBOL_RE = re.compile(r"pub\s+extern\s+\"system\"\s+fn\s+(Java_[\w]+)")


def expected_symbol(package: str, name: str) -> str:
    return "Java_" + package.replace(".", "_") + "_NativeBridge_" + name


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="repository root")
    args = parser.parse_args()
    root = Path(args.root).resolve()

    kotlin = root / KOTLIN
    rust = root / RUST
    for path in (kotlin, rust):
        if not path.is_file():
            print(f"missing {path.relative_to(root)}")
            return 1

    kotlin_text = kotlin.read_text(encoding="utf-8")
    rust_text = rust.read_text(encoding="utf-8")

    package_match = PACKAGE_RE.search(kotlin_text)
    if not package_match:
        print(f"no package declaration in {KOTLIN}")
        return 1
    package = package_match.group(1)

    declared = sorted(set(EXTERNAL_RE.findall(kotlin_text)))
    exported = sorted(set(SYMBOL_RE.findall(rust_text)))
    weak = sorted(set(WEAK_SYMBOL_RE.findall(rust_text)) - set(exported))

    problems: list[str] = []

    for name in declared:
        symbol = expected_symbol(package, name)
        if symbol not in exported:
            problems.append(
                f"{name} is declared external in Kotlin but {symbol} is not exported from Rust"
            )

    prefix = "Java_" + package.replace(".", "_") + "_NativeBridge_"
    for symbol in exported:
        if not symbol.startswith(prefix):
            problems.append(
                f"{symbol} does not match the Kotlin package '{package}' "
                f"(expected the prefix {prefix})"
            )
        name = symbol[len(prefix):]
        if name not in declared:
            problems.append(f"{symbol} is exported from Rust but no Kotlin external fun declares it")

    for symbol in weak:
        problems.append(
            f"{symbol} is extern \"system\" but not #[no_mangle] — the JVM will not find it"
        )

    print(f"package: {package}")
    print(f"external funs (Kotlin): {len(declared)}   exported symbols (Rust): {len(exported)}")
    for name in declared:
        print(f"  - {name}  ->  {expected_symbol(package, name)}")

    if problems:
        print(f"\n{len(problems)} problem(s):")
        for problem in problems:
            print(f"  x {problem}")
        return 1

    print("OK every external fun has a matching #[no_mangle] extern \"system\" symbol")
    return 0


if __name__ == "__main__":
    sys.exit(main())
