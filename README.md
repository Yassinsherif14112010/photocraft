# Photo Craft Mobile — Android

**PhotoCraft on your phone.** The full PhotoCraft engine (clean-room Photoshop
reimplementation, pure Rust) compiled for Android and driven by a React Native UI
through a thin Kotlin/JNI/C++ bridge. Local AI (OCR + background removal), real
PSD/PSB, real layers — no mocks anywhere.

```
React Native (TypeScript)  ← UI: Text Studio (RTL/عربي), Styles, Assets, Brand Kit, Export, Smart Resize
        │  NativeModules
Kotlin + SurfaceView       ← canvas frames, file I/O, document picker glue
        │  JNI (C++)
android-ffi (C ABI)        ← rust-core/crates/android-ffi
        │
PhotoCraft Rust core       ← doc · layers · groups · masks · 28 blend modes · 10 layer styles
                             text engine (Arabic shaping) · SVG · PSD/PSB I/O · codecs (PNG/JPEG/WebP)
ONNX Runtime (local)       ← PaddleOCR (AR/EN) · BiRefNet Lite matting
```

## Feature map (all implemented against the real engine — no placeholders)

| Module | Where |
|---|---|
| Document / Layer / Group / Mask engines | `rust-core/crates/{doc,compose}` via `engine.execute` |
| Blend modes (28) + layer styles (10: shadow/glow/stroke/overlay/satin/bevel…) | engine `doc::Effects`, UI `src/core/engines/LayerStyles.ts` |
| Text Studio: point/paragraph text, RTL عربي/English, kerning/tracking/leading, styles, fonts, transform, persistence | `rust-core/crates/text`, UI `TextStudio.ts` |
| SVG import (subset → shape layers), export, groups, metadata, validation, capability detection | engine `svg_cmds.rs` (new real module), UI `SvgEngine.ts` |
| PSD / PSB save+load (layers, masks, effects, TySh text) | `rust-core/crates/psd` + `io`, UI `ExportCenter.ts` |
| Export Center: PNG/JPG/WebP/PSD/PSB + quality/presets/transparent | `rust-core/crates/{codecs,io}` |
| OCR (AR/EN, local PaddleOCR): language detection, batch, provenance notes, text-layer creation | `ai/OcrEngine.kt`, UI `OcrEngine.ts` |
| Background removal: local BiRefNet Lite (quick 512² / HQ 1024² + matte refinement) → real layer mask, plus engine Select Subject (`layer.removeBackground`) | `ai/BackgroundRemovalEngine.kt` + `ai/MatteRefine.kt`, UI `BackgroundRemoval.ts` |
| Asset Library: icons/shapes/stickers/search/favorites/recents | `src/core/engines/AssetLibrary.ts` + bundled SVGs |
| Brand Kit: colors/fonts/logos/templates/reusable styles | `src/core/engines/BrandKit.ts` |
| Smart Resize: IG/FB/TikTok/YT/Pinterest/LinkedIn + bounds-based refit + real guides + history | `src/core/engines/SmartResize.ts` |

## Build

```bash
# 0) toolchains: Rust ≥1.95 + cargo-ndk, Android NDK 27, JDK 17, Node ≥18
# 1) Rust core → .so per ABI → jniLibs, then Gradle:
bash scripts/build-android.sh
# 2) one-time AI models (local inference):
bash scripts/fetch-models.sh
adb push ocr_models/*      /data/data/com.photocraft.mobile/files/models/ocr/
adb push birefnet_models/* /data/data/com.photocraft.mobile/files/models/birefnet/
# 3) dev loop:
npm install && npm run android
```

## Engineering notes

- **One engine, one truth.** Every document mutation goes through the upstream
  command registry (`engine.execute`) — the exact commands the desktop app and
  CLI use. Undo/redo is the engine's history, not a JS copy.
- **PSD fidelity.** Saves keep layers, masks, 10-style effect stacks (`lfx2`),
  text (`TySh`/`Txt2`), groups, guides; PSB automatically for big canvases.
- **AI is local and honest.** Missing models disable the feature with a clear
  message; the pipeline (DBNet box extraction, unclip, CTC decode, BiRefNet
  normalize/sigmoid) is implemented for real in `ai/`.
- **ABI**: `arm64-v8a`, `armeabi-v7a` (+ `x86_64` emulator); Rust profile `release`
  with LTO; minSdk 24.

Upstream: https://gitlab.com/jjah2/photocraft (MIT OR Apache-2.0)
