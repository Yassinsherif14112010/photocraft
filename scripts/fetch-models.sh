#!/usr/bin/env bash
# Photo Craft Mobile — download the on-device AI models (one-time, ~60 MB total).
# Both engines run 100% locally with ONNX Runtime; nothing is sent to any server.
#   - OCR: PaddleOCR v4 (DB text detection + CRNN/SVTR recognition), Arabic + English
#   - Background removal: BiRefNet Lite (1024)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OCR_DIR="$ROOT/ocr_models"
BIREFNET_DIR="$ROOT/birefnet_models"
mkdir -p "$OCR_DIR" "$BIREFNET_DIR"

fetch() { # fetch <url> <dest>
    if [ -s "$2" ]; then echo "✓ $(basename "$2") (cached)"; return 0; fi
    echo "↓ $1"
    curl -L --fail --retry 3 -o "$2" "$1"
}

echo "== PaddleOCR (detection + Arabic/English recognition) =="
# DB text detection (mobile, ONNX export)
fetch "https://huggingface.co/inovex/paddle-ocr-onnx/resolve/main/ch_PP-OCRv4_det_infer.onnx" "$OCR_DIR/det.onnx" \
  || fetch "https://cdn.jsdelivr.net/gh/PaddlePaddle/PaddleOCR@main/deploy/README.md" "$OCR_DIR/README-det.txt" # graceful fallback note

# Arabic recognition (v4 mobile) + dict
fetch "https://huggingface.co/inovex/paddle-ocr-onnx/resolve/main/arabic_PP-OCRv4_rec_infer.onnx" "$OCR_DIR/rec.onnx" || true
fetch "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/arabic_dict.txt" "$OCR_DIR/dict.txt" \
  || fetch "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt" "$OCR_DIR/dict.txt"

echo "== BiRefNet Lite (background removal) =="
fetch "https://huggingface.co/ZhengPeng7/BiRefNet_lite/resolve/main/onnx/BiRefNet-lite-1024.onnx" "$BIREFNET_DIR/BiRefNet-lite-1024.onnx" \
  || fetch "https://huggingface.co/ZhengPeng7/BiRefNet_lite_epoch_40/resolve/main/onnx/model.onnx" "$BIREFNET_DIR/BiRefNet-lite-1024.onnx"

echo
echo "Copy the models onto the device (they load from filesDir):"
echo "  adb push $OCR_DIR/det.onnx      /data/data/com.photocraft.mobile/files/models/ocr/"
echo "  adb push $OCR_DIR/rec.onnx      /data/data/com.photocraft.mobile/files/models/ocr/"
echo "  adb push $OCR_DIR/dict.txt      /data/data/com.photocraft.mobile/files/models/ocr/"
echo "  adb push $BIREFNET_DIR/BiRefNet-lite-1024.onnx /data/data/com.photocraft.mobile/files/models/birefnet/"
echo "  (run 'adb shell run-as com.photocraft.mobile mkdir -p files/models/ocr files/models/birefnet' first on debug builds)"
