# AI Models — 100% on-device

Photo Craft Mobile runs all AI **locally** with ONNX Runtime (`onnxruntime-android`).
No cloud services, no paid APIs, no telemetry. Run `scripts/fetch-models.sh` once to
download the open models, then push them to the app's files directory (paths in the
script output).

| Engine | Model | Task | Where it plugs in |
|---|---|---|---|
| OCR | PaddleOCR `ch_PP-OCRv4_det_infer` (ONNX) | DBNet text detection | `ai/OcrEngine.kt` (`det.onnx`) |
| OCR | PaddleOCR `arabic_PP-OCRv4_rec_infer` (ONNX) | Arabic + English recognition (CTC) | `ai/OcrEngine.kt` (`rec.onnx` + `dict.txt`) |
| Background removal | BiRefNet Lite 1024 (ONNX) | SOD matting → alpha mask | `ai/BackgroundRemovalEngine.kt` |

Both modules degrade loudly (never silently fake results): if a model file is missing
the feature reports "models missing — run scripts/fetch-models.sh" instead of
pretending to work.
