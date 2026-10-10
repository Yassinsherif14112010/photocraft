# PhotoCraft for Android

PhotoCraft's Android app is a **real PhotoCraft**: the editing engine is the same Rust engine this
repository already ships (`crates/engine` and the crates under it), compiled for Android and driven
from Kotlin through JNI. There is no second document model, no JavaScript bridge and no webview
shell — every edit goes through the engine's command registry, every preview comes from the
engine's compositor, and every project is saved as a native `.pcraft` file.

```
Kotlin UI (Jetpack-free, Material Components)      android/app/src/main/kotlin
        │  one command per user action
        ▼
NativeBridge (18 external funs)                   …/core/NativeBridge.kt
        │  JNI  (Java_ai_storyteller_photocraft_core_NativeBridge_*)
        ▼
photocraft-jni                                    android/jni-rust/src/lib.rs
        │
        ▼
photocraft-engine  →  doc / ops / compose / format / io / algo / text / vector
```

## Layout of the module

| Path | What it is |
| --- | --- |
| `android/jni-rust/` | The Rust crate (`photocraft-jni`) that links the engine into `libphotocraft.so`. |
| `android/app/src/main/kotlin/…/core/` | `NativeBridge`, `Engine` (one open document), `DocumentInfo`. |
| `android/app/src/main/kotlin/…/ai/` | `ModelSpec`, `ModelManager` (download + verify), `BackgroundRemover` (ONNX Runtime). |
| `android/app/src/main/kotlin/…/data/` | Projects, presets, asset library, brand kit, settings. |
| `android/app/src/main/kotlin/…/ui/` | Home, editor (canvas + panels), templates, assets, brand kit, settings. |
| `android/app/src/main/res/` | Adaptive resources: `values/`, `values-night/`, `values-sw600dp/`, `values-sw840dp/`, `values-ar/`, 21 layouts, 30 vector drawables. |
| `android/app/src/main/assets/models.conf` | A byte-identical copy of `scripts/models.conf` (enforced by `tools/check_models_conf.py`). |

## Building

Requirements (check them first):

```bash
scripts/check-prereqs.sh        # JDK 17+, cargo + cargo-ndk, Android SDK + NDK 27, platform 35
```

Build:

```bash
# Linux / macOS
scripts/build-android.sh                    # release APKs (3 ABIs + universal)
scripts/build-android.sh --debug            # debug
scripts/build-android.sh --abi arm64-v8a    # one ABI
scripts/build-android.sh --with-models      # also download the background-removal models
scripts/build-android.sh --install          # install on the connected device

# Windows PowerShell
.\scripts\build-android.ps1
.\scripts\build-android.ps1 -Debug -Abi arm64-v8a
.\scripts\build-android.ps1 -WithModels -Install

# Windows CMD (wrapper around the PowerShell script)
scripts\build-android.bat -Debug
```

Artifacts land in `android/app/build/outputs/…` and are copied to `dist/android/`.

The Gradle build compiles the engine automatically (`buildRust` task, `cargo ndk -o
src/main/jniLibs -t <abi> build --release`). Pass `-Pphotocraft.skipNative=true` to reuse an
already-built `libphotocraft.so` — the build **fails** if the library is missing for any requested
ABI, rather than shipping an app that cannot edit.

### Signing

No key is committed. `debug` uses the shared debug keystore. For a release APK, either put the
keystore outside the repository and reference it from `~/.gradle/gradle.properties`, or sign the
unsigned artifact manually:

```bash
apksigner sign --ks ~/photocraft.keystore dist/android/app-arm64-v8a-release-unsigned.apk
```

## Adaptive UI

`ui/common/WindowClass.kt` computes Material window size classes from `WindowMetricsCalculator`,
i.e. from the **real** window: a foldable reports a new class when it folds, split-screen reports
half the screen, and a desktop windowing session reports the free-form window. Nothing is
hard-coded per device model.

| Window class | Home grid | Editor |
| --- | --- | --- |
| Compact (< 600 dp) | 2 columns | Panels in the bottom sheet |
| Medium (600–839 dp) | 3 columns | Panels in a side panel beside the canvas |
| Expanded (≥ 840 dp) | 4 columns | Side panel, wider canvas budget |

`values-sw600dp` and `values-sw840dp` change gutters and panel widths, and `values-night`
re-colours the whole app. Arabic (`values-ar`) is a complete, key-for-key mirror of `values`
(276 strings each, enforced by `tools/check_resources.py`), and every layout uses start/end
padding, so the UI mirrors automatically.

## Background removal

Two paths, both on-device, and the UI never blurs the difference between them:

1. **Quick Remove** — the engine's own Select Subject → Refine Edge → layer mask
   (`crates/algo/src/segment`). Pure Rust, no download, works offline, one undo step, non-
   destructive layer mask.
2. **High-quality Remove** — a BiRefNet / U²-Net ONNX model run with ONNX Runtime. The model is
   downloaded on demand from `scripts/models.conf`, verified by size **and** SHA-256, and the
   panel reports its real state (`missing` / `valid` / `corrupt`). If the model is not on the
   device, the panel says so and offers the download; it never simulates a result.

```bash
scripts/fetch-models.sh  --tier quick      #   4.7 MB
scripts/fetch-models.sh  --tier balanced   # 224   MB
scripts/fetch-models.sh  --tier hq         # 973   MB
scripts/fetch-models.sh  --verify          # check what is already installed
```

## Tests

```bash
tests/test_tools.sh            # everything this machine can run
```

| Test | What it proves |
| --- | --- |
| `tests/test_fetch_models.sh` | 22 assertions: HTTP errors, resume, retries, size + SHA-256 verification, `--verify`, manifest shape. Runs a real local HTTP server. |
| `tools/check_resources.py` | Every string/drawable/dimen/color/menu/style reference resolves; `values` and `values-ar` define the same keys. |
| `tools/check_models_conf.py` | Manifest field/URL/checksum validity and that the app asset is byte-identical. |
| `tools/check_jni_symbols.py` | Every `external fun` in Kotlin has a `#[no_mangle] extern "system"` Rust symbol (and vice versa). |
| `cargo test` / `cargo clippy` | Run when a Rust toolchain is present; reported as SKIP otherwise. |
| `gradle :app:assembleDebug` | Run when a JDK 17+ and the Android SDK are present; SKIP otherwise. |

## Known limits

* The `.so`, the APK and on-device tests can only be produced on a machine with the Android SDK,
  the NDK and a Rust toolchain — this repository's CI sandbox has none of them, so those steps are
  reported as skipped, never as passing.
* `layer.rasterize.*`, `layer.groupLayers`, `layer.layerMask.*` and the adjustment commands are the
  engine's own; the Android UI exposes the subset that makes sense on a touch screen (the full list
  is at `crates/engine/src/commands.rs`).
* OCR is **not** implemented: there is no text-recognition model in this repository, and adding one
  would mean adding a model and a licence. Everything else the app claims to do is wired to real
  engine commands.
