#!/usr/bin/env python3
"""
check_balance.py — delimiter-balance smoke check for Kotlin and Rust sources.

A character-level scan (not regex substitution) that tracks:
  * line comments //, block comments /* */ (nested, as Kotlin allows),
  * normal strings "...", escaped chars, and string templates ${ ... }
    (whose inner braces are counted as code, as the compiler sees them),
  * raw strings \"\"\" ... \"\"\" (Kotlin).

Reports any file where { }, ( ), [ ] end unbalanced. This is a lint-level
smoke check — the authoritative validation is kotlinc/cargo, which require
toolchains this environment does not have.
"""
import sys
from pathlib import Path


def check(path: Path) -> str | None:
    s = path.read_text()
    i, n = 0, len(s)
    braces = parens = brackets = 0
    state = None  # None | 'line' | 'block' | 'str' | 'raw'
    block_depth = 0
    template_depth = 0  # >0 while inside ${ } inside a normal string

    while i < n:
        c = s[i]
        nxt = s[i + 1] if i + 1 < n else ""

        if state == 'line':
            if c == '\n':
                state = None
            i += 1
            continue

        if state == 'block':
            if c == '/' and nxt == '*':
                block_depth += 1
                i += 2
                continue
            if c == '*' and nxt == '/':
                block_depth -= 1
                if block_depth == 0:
                    state = None
                i += 2
                continue
            i += 1
            continue

        if state == 'raw':
            if c == '"' and s[i:i + 3] == '"""':
                state = None
                i += 3
                continue
            i += 1
            continue

        if state == 'str':
            if c == '\\':
                i += 2
                continue
            if template_depth > 0:
                if c == '{':
                    braces += 1
                elif c == '}':
                    braces -= 1
                    template_depth -= 1 if template_depth else 0
                    # note: braces inside ${...} belong to code; when the
                    # template expression closes we drop back to string mode
                    if template_depth == 0:
                        pass
                    i += 1
                    continue
                elif c == '"':
                    # quote inside an expression — treat as string end only
                    # if template already closed (handled above)
                    state = None
                    i += 1
                    continue
            if c == '"':
                state = None
                i += 1
                continue
            if c == '$' and nxt == '{':
                template_depth += 1
                braces += 1
                i += 2
                continue
            i += 1
            continue

        # code state
        if c == '/' and nxt == '/':
            state = 'line'
            i += 2
            continue
        if c == '/' and nxt == '*':
            state = 'block'
            block_depth = 1
            i += 2
            continue
        if c == '"' and s[i:i + 3] == '"""':
            state = 'raw'
            i += 3
            continue
        if c == '"':
            state = 'str'
            i += 1
            continue
        if c == "'":
            # char literal: skip escaped or single char
            if nxt == '\\':
                i += 3
            else:
                i += 2
            continue
        if c == '{':
            braces += 1
        elif c == '}':
            braces -= 1
        elif c == '(':
            parens += 1
        elif c == ')':
            parens -= 1
        elif c == '[':
            brackets += 1
        elif c == ']':
            brackets -= 1
        i += 1

    for name, val in (("{}", braces), ("()", parens), ("[]", brackets)):
        if val != 0:
            return f"{path}: {name} unbalanced (delta {val})"
    return None


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    files = sorted(root.glob("android/app/src/main/java/**/*.kt")) + [
        root / "rust-core/crates/android-ffi/src/lib.rs",
    ]
    problems = [msg for f in files if f.exists() and (msg := check(f))]
    if problems:
        print("\n".join(problems))
        return 1
    print(f"OK — {len(files)} Kotlin/Rust files delimiter-balanced")
    return 0


if __name__ == "__main__":
    sys.exit(main())
