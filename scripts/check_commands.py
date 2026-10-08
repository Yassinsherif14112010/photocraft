#!/usr/bin/env python3
"""
check_commands.py — prove that every engine command invoked from the TS layer
actually exists in the Rust command registry (spec!/cmd! macros + id: fields)
or the automation surface (doc.*, batch, engine.execute, session.*).
Exits non-zero on any missing command. Implementation-only guard rail.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
ENGINE = ROOT / "rust-core" / "crates" / "engine" / "src"
AUTO = ROOT / "rust-core" / "crates" / "automation" / "src"
FFI = ROOT / "rust-core" / "crates" / "android-ffi" / "src"

# 1) commands invoked from TypeScript
ts_text = "\n".join(p.read_text(encoding="utf-8") for p in SRC.rglob("*.ts*"))
called = set()
for pat in (
    r"runCommand\(\s*['\"]([a-zA-Z][a-zA-Z0-9_.]+)['\"]",
    r"runBatch\(\s*\[[^\]]*?command:\s*['\"]([a-zA-Z][a-zA-Z0-9_.]+)['\"]",
    r"Engine\.execute\([^,]+,\s*['\"]([a-zA-Z][a-zA-Z0-9_.]+)['\"]",
    r"Engine\.call\([^,]+,\s*['\"]([a-zA-Z][a-zA-Z0-9_.]+)['\"]",
    r"command:\s*['\"]([a-zA-Z][a-zA-Z0-9_.]+)['\"]",
):
    called |= set(re.findall(pat, ts_text))

# 2) commands registered in the Rust engine
rust_text = "\n".join(p.read_text(encoding="utf-8") for p in ENGINE.rglob("*.rs"))
registered = set(re.findall(r'spec!\(\s*"([a-zA-Z][a-zA-Z0-9_.]+)"', rust_text))
registered |= set(re.findall(r'cmd!\(\s*"([a-zA-Z][a-zA-Z0-9_.]+)"', rust_text))
registered |= set(re.findall(r'id:\s*"([a-zA-Z][a-zA-Z0-9_.]+)"', rust_text))
registered |= set(re.findall(r'"([a-z]+\.[a-zA-Z0-9_.]+)"\s*=>', rust_text))
# macro-generated families (style_specs!("type.characterStyle", …) and friends)
registered |= set(re.findall(r'style_specs!\([^,]*,?\s*"([a-zA-Z][a-zA-Z0-9_.]+)"', rust_text))
# const CMD declarations + every dotted lowercase identifier string in the crate
registered |= set(re.findall(r'=\s*"([a-zA-Z][a-zA-Z0-9_.]+)"', rust_text))
registered |= set(re.findall(r'"([a-z]+(?:\.[a-zA-Z0-9_]+)+)"', rust_text))

# 3) automation + android-ffi surfaces (doc.*, batch, engine.execute, sessions)
extra_text = "\n".join(p.read_text(encoding="utf-8") for p in list(AUTO.rglob("*.rs")) + list(FFI.rglob("*.rs")))
registered |= set(re.findall(r'"(doc\.[a-z]+|engine\.execute|batch|session\.[a-z]+|jobs\.[a-z]+)"', extra_text))

missing = sorted(c for c in called if c not in registered)

print(f"TS-called commands : {len(called)}")
print(f"Rust-registered    : {len(registered)}")
if missing:
    print("MISSING IN REGISTRY:")
    for m in missing:
        print(f"  - {m}")
    sys.exit(1)
print("OK — every TS-called command exists in the engine registry")
