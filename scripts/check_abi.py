#!/usr/bin/env python3
"""
check_abi.py — static ABI consistency check across the three native layers:

    rust-core/crates/android-ffi/src/lib.rs   (authoritative C ABI, #[no_mangle])
    android/app/src/main/cpp/photocraft_jni.cpp (extern "C" prototypes + JNI glue)
    android/app/src/main/java/com/photocraft/mobile/engine/PhotoCraftJni.kt (externals)

What is checked (honestly — this is a static analysis, NOT a compiled ABI dump):
  1. every #[no_mangle] pcm_* export in Rust has a matching declaration in the
     C++ translation unit, and vice versa (no missing / stale symbols);
  2. integer parameter widths agree: Rust u32 ↔ C++ uint32_t, Rust u64 ↔ C++
     uint64_t, pointers ↔ pointers — derived per-function by parsing both
     signatures in order (usize is rejected on the Rust side by policy);
  3. every Kotlin `external fun` has a JNI entry point in the C++ file with the
     exact expected mangled name
     (Java_com_photocraft_mobile_engine_PhotoCraftJni_<name>), and the Kotlin
     parameter count matches the JNI C function's parameter count;
  4. System.loadLibrary("photocraft_mobile_jni") matches the CMake target name,
     and the CMake IMPORTED_LOCATION matches the Rust crate's lib name.

Exit code 0 = all checks passed; 1 = any mismatch (the script never guesses).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUST = ROOT / "rust-core/crates/android-ffi/src/lib.rs"
CPP = ROOT / "android/app/src/main/cpp/photocraft_jni.cpp"
KOTLIN = ROOT / "android/app/src/main/java/com/photocraft/mobile/engine/PhotoCraftJni.kt"
CMAKE = ROOT / "android/app/src/main/cpp/CMakeLists.txt"

RUST_WIDTH = {"u32": "uint32_t", "u64": "uint64_t", "u8": "uint8_t"}
errors: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


def parse_rust_exports(src: str) -> dict[str, list[str]]:
    """Return {pcm_name: [param types]} from #[no_mangle] pub extern \"C\" fns."""
    out = {}
    for m in re.finditer(
        r"#\[no_mangle\]\s*pub\s+(?:unsafe\s+)?extern\s+\"C\"\s+fn\s+(\w+)\s*\(([^)]*)\)",
        src,
    ):
        name = m.group(1)
        params = []
        for p in m.group(2).split(","):
            p = p.strip()
            if not p:
                continue
            ptype = p.split(":")[-1].strip()
            ptype = ptype.replace("*const ", "*").replace("*mut ", "*").strip()
            params.append(ptype)
        out[name] = params
    return out


def parse_cpp_decls(src: str) -> dict[str, list[str]]:
    """Return {pcm_name: [param types]} from the extern \"C\" block."""
    out = {}
    for m in re.finditer(
        r"^\s*(\w[\w\s\*]*?)\s+(pcm_\w+)\s*\(([^)]*)\)\s*;", src, re.M
    ):
        ret = m.group(1).strip()
        name = m.group(2)
        params = []
        for p in m.group(3).split(","):
            p = p.strip()
            if not p:
                continue
            params.append(p)
        out[name] = params
    return out


TYPE_WORDS = {"unsigned", "signed", "char", "short", "int", "long", "void",
              "uint8_t", "uint16_t", "uint32_t", "uint64_t",
              "int8_t", "int16_t", "int32_t", "int64_t", "size_t"}


def _type_only(param: str) -> str:
    """Drop the parameter name: 'uint8_t* ptr' → 'uint8_t*', '*mut u64' → '*u64'."""
    tokens = param.strip().split()
    while len(tokens) > 1 and tokens[-1].rstrip("*") not in TYPE_WORDS:
        tokens.pop()
    return " ".join(tokens)


def param_width_kinds(params: list[str]) -> list[str]:
    """Reduce parameter lists (either language) to comparable canonical kinds.

    Both sides must agree on the *pointee width* of pointers and the width of
    by-value integers — a ``*mut u64`` (Rust) and a ``uint64_t*`` (C++) are the
    same ABI object and reduce to the same kind.
    """
    kinds = []
    for p in params:
        p = _type_only(p)
        p = re.sub(r"\bconst\b|\bmut\b", "", p).strip()
        is_ptr = "*" in p
        t = p.replace("*", "").strip()
        if t in ("u8", "uint8_t", "unsigned char"):
            w = "u8"
        elif t in ("u64", "uint64_t", "unsigned long long"):
            w = "u64"
        elif t in ("u32", "uint32_t", "unsigned int"):
            w = "u32"
        elif t in ("c_char", "char"):
            w = "cstr"
        else:
            w = "opaque"
        if is_ptr:
            kinds.append(w + "*")
        elif w in ("u8", "u64", "u32"):
            kinds.append(w)
        # by-value opaque (void) params carry no width — skipped
    return kinds


def main() -> int:
    rust_src = RUST.read_text()
    cpp_src = CPP.read_text()
    kotlin_src = KOTLIN.read_text()
    cmake_src = CMAKE.read_text()

    rust_fns = parse_rust_exports(rust_src)
    # C prototypes inside extern "C" — restrict to that block for accuracy.
    extern_block = re.search(r'extern "C"\s*\{(.*?)\}\s*//\s*extern', cpp_src, re.S)
    block = extern_block.group(1) if extern_block else cpp_src
    cpp_fns = parse_cpp_decls(block)

    # 1. symbol sets agree
    only_rust = sorted(set(rust_fns) - set(cpp_fns))
    only_cpp = sorted(set(cpp_fns) - set(rust_fns))
    if only_rust:
        fail(f"exported in Rust but not declared in C++: {only_rust}")
    if only_cpp:
        fail(f"declared in C++ but not exported from Rust: {only_cpp}")

    # 2. parameter width agreement (both sides reduced to canonical kinds)
    for name in sorted(set(rust_fns) & set(cpp_fns)):
        rk = param_width_kinds(rust_fns[name])
        ck = param_width_kinds(cpp_fns[name])
        if len(rk) != len(ck):
            fail(f"{name}: parameter count differs Rust={rk} C++={ck}")
            continue
        for i, (r, c) in enumerate(zip(rk, ck)):
            if r != c:
                fail(f"{name}: param #{i} width differs Rust={r} C++={c}")
        if "usize" in [t.split("*")[-1] for t in rust_fns[name]]:
            fail(f"{name}: uses usize across the ABI (forbidden)")

    # 3. Kotlin externals ↔ JNI symbols
    for m in re.finditer(r"external\s+fun\s+(\w+)\s*\(([^)]*)\)", kotlin_src):
        fname, params = m.group(1), m.group(2).strip()
        symbol = f"Java_com_photocraft_mobile_engine_PhotoCraftJni_{fname}"
        if symbol not in cpp_src:
            fail(f"Kotlin external {fname} has no JNI symbol {symbol}")
            continue
        # Extract the JNI function's full parameter list and drop the standard
        # JNIEnv* + jclass prefix; what remains must match the Kotlin params.
        sym_m = re.search(re.escape(symbol) + r"\s*\(([^)]*)\)", cpp_src)
        if not sym_m:
            fail(f"{fname}: JNI symbol present but signature unparsable")
            continue
        jni_params = [p.strip() for p in sym_m.group(1).split(",") if p.strip()]
        if len(jni_params) < 2:
            fail(f"{fname}: JNI entry lacks JNIEnv*/jclass prefix")
            continue
        rest = jni_params[2:]
        kotlin_n = len([p for p in params.split(",") if p.strip()])
        if len(rest) != kotlin_n:
            fail(f"{fname}: Kotlin has {kotlin_n} params, JNI entry declares {len(rest)}")

    # JNI symbols without a Kotlin declaration (stale glue).
    for m in re.finditer(r"Java_com_photocraft_mobile_engine_PhotoCraftJni_(\w+)\s*\(", cpp_src):
        sym = m.group(1)
        if f"external fun {sym}" not in kotlin_src:
            fail(f"JNI symbol {sym} has no Kotlin external declaration")

    # 4. library names agree end to end
    load = re.search(r'System\.loadLibrary\("([^"]+)"\)', kotlin_src)
    # The JNI target is the SHARED library with sources (not the IMPORTED Rust lib).
    targets = re.findall(r"add_library\((\w+)\s+SHARED\s+(?!IMPORTED)(\w[\w.]*)", cmake_src)
    if not load:
        fail("Kotlin System.loadLibrary not found")
    if not targets:
        fail("CMake add_library(<name> SHARED <sources>) not found")
    target_names = [t[0] for t in targets]
    if load and target_names and load.group(1) not in target_names:
        fail(f"loadLibrary({load.group(1)}) not among CMake SHARED targets {target_names}")
    imported = re.search(r"IMPORTED_LOCATION\s+\"([^\"]+)\"", cmake_src)
    if imported and "libphotocraft_android_ffi.so" not in imported.group(1):
        fail(f"CMake imports '{imported.group(1)}' but the Rust cdylib is libphotocraft_android_ffi.so")
    lib_name = re.search(r'\[lib\]\s*name\s*=\s*"([^"]+)"', (RUST.parent.parent / "Cargo.toml").read_text())
    if imported and lib_name and f"lib{lib_name.group(1)}.so" not in imported.group(1):
        fail(f"CMake imports a different lib than Rust builds: lib{lib_name.group(1)}.so")

    for n in notes:
        print(n)
    if errors:
        print("ABI CHECK FAILED:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(f"OK — {len(rust_fns)} Rust exports ↔ C++ declarations agree; "
          f"Kotlin externals ↔ JNI symbols agree; library names consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
