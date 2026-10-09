#!/usr/bin/env bash
# Photo Craft Mobile — download the on-device AI models (one-time, ~60 MB total).
# Both engines run 100% locally with ONNX Runtime; nothing is sent to any server.
#   - OCR: PaddleOCR v4 (DB text detection + CRNN/SVTR recognition), Arabic + English
#   - Background removal: BiRefNet Lite (1024)
#
# Single source of truth for model locations (matches the Kotlin engines):
#   models/ocr/det.onnx, models/ocr/rec.onnx, models/ocr/dict.txt
#   models/birefnet/BiRefNet-lite-1024.onnx
# On the device they load from:
#   <filesDir>/models/ocr/…   and   <filesDir>/models/birefnet/…
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS="$ROOT/models"
OCR_DIR="$MODELS/ocr"
BIREFNET_DIR="$MODELS/birefnet"
mkdir -p "$OCR_DIR" "$BIREFNET_DIR"

fail() { echo "FETCH ERROR: $*" >&2; exit 1; }

fetch() { # fetch <url> <dest> <min-bytes>
    if [ -s "$2" ] && [ "$(stat -c%s "$2")" -ge "$3" ]; then
        echo "OK $(basename "$2") ($(stat -c%s "$2") bytes, cached)"
        return 0
    fi
    echo "downloading $1"
    curl -L --fail --retry 3 -o "$2" "$1" || {
        rm -f "$2"
        return 1
    }
    [ "$(stat -c%s "$2")" -ge "$3" ] || {
        rm -f "$2"
        return 1
    }
}

echo "== PaddleOCR (detection + Arabic/English recognition) =="
fetch "https://huggingface.co/inovex/paddle-ocr-onnx/resolve/main/ch_PP-OCRv4_det_infer.onnx" \
    "$OCR_DIR/det.onnx" 1000000 \
    || fetch "https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_det_infer.onnx" \
        "$OCR_DIR/det.onnx" 1000000 \
    || fail "det.onnx download failed (OCR text detection model)"

fetch "https://huggingface.co/inovex/paddle-ocr-onnx/resolve/main/arabic_PP-OCRv4_rec_infer.onnx" \
    "$OCR_DIR/rec.onnx" 1000000 \
    || fail "rec.onnx download failed (Arabic/English recognition model)"

fetch "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/dict/arabic_dict.txt" \
    "$OCR_DIR/dict.txt" 1000 \
    || fetch "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt" \
        "$OCR_DIR/dict.txt" 1000 \
    || fail "dict.txt download failed (OCR character dictionary)"

echo "== BiRefNet Lite (background removal) =="
fetch "https://huggingface.co/ZhengPeng7/BiRefNet_lite/resolve/main/onnx/BiRefNet-lite-1024.onnx" \
    "$BIREFNET_DIR/BiRefNet-lite-1024.onnx" 1000000 \
    || fetch "https://huggingface.co/ZhengPeng7/BiRefNet_lite_epoch_40/resolve/main/onnx/model.onnx" \
        "$BIREFNET_DIR/BiRefNet-lite-1024.onnx" 1000000 \
    || fail "BiRefNet-lite-1024.onnx download failed (background-removal model)"

echo
echo "All models fetched under $MODELS"
echo "Copy them onto the device (app-private storage; the app loads from filesDir):"
echo "  adb shell run-as com.photocraft.mobile mkdir -p files/models/ocr files/models/birefnet"
echo "  adb push \"$OCR_DIR/det.onnx\"                /data/local/tmp/ && adb shell run-as com.photocraft.mobile cp /data/local/tmp/det.onnx files/models/ocr/"
echo "  adb push \"$OCR_DIR/rec.onnx\"                /data/local/tmp/ && adb shell run-as com.photocraft.mobile cp /data/local/tmp/rec.onnx files/models/ocr/"
echo "  adb push \"$OCR_DIR/dict.txt\"                /data/local/tmp/ && adb shell run-as com.photocraft.mobile cp /data/local/tmp/dict.txt files/models/ocr/"
echo "  adb push \"$BIREFNET_DIR/BiRefNet-lite-1024.onnx\" /data/local/tmp/ && adb shell run-as com.photocraft.mobile cp /data/local/tmp/BiRefNet-lite-1024.onnx files/models/birefnet/"
echo
echo "Note: if a model file is missing at runtime, the app reports exactly which"
echo "file it expected and where (isModelReady returns false; OCR/BG-removal"
echo "workspaces show the actionable error) — startup never depends on models."
