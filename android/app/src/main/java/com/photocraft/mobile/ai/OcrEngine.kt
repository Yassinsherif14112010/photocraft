package com.photocraft.mobile.ai

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import java.nio.FloatBuffer
import java.util.concurrent.atomic.AtomicReference

/**
 * Fully on-device OCR engine (PaddleOCR-style: DB text detection + CRNN-SVTR
 * recognition). Arabic + English. No network, no cloud, no paid API: both models
 * are local ONNX files under `filesDir/models/ocr/` (downloaded once by
 * scripts/fetch-models.sh or bundled by the distributor).
 *
 * Pipeline:
 *   1. `det`   — DBNet probability map -> rotated text boxes (AiGeometry.dbBoxes)
 *  2. crop/warp each box, pad, resize to 48px height
 *  3. `rec`   — CRNN/SVTR encoder -> [T, C] logits -> CTC greedy decode
 *  4. every box carries its text, confidence and pixel bounding box so React can
 *     create a real TextLayer through the engine (`text.add` / OCR metadata).
 */
class OcrEngine(context: Context) {

    data class OcrBox(
        val text: String,
        val confidence: Float,
        val x: Float,
        val y: Float,
        val w: Float,
        val h: Float,
        val angleRad: Float,
    )

    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val detSession = AtomicReference<OrtSession?>(null)
    private val recSession = AtomicReference<OrtSession?>(null)
    private var detInput: String = "x"
    private var recInput: String = "x"
    private var dict: List<String> = emptyList()

    private val modelsDir get() = java.io.File(context.filesDir, "models/ocr").apply { mkdirs() }

    fun isReady(): Boolean = java.io.File(modelsDir, "det.onnx").exists() &&
        java.io.File(modelsDir, "rec.onnx").exists() &&
        java.io.File(modelsDir, "dict.txt").exists()

    /** Lazily load/refresh sessions from disk (cheap when already open). */
    private fun ensureSessions() {
        val detFile = java.io.File(modelsDir, "det.onnx")
        val recFile = java.io.File(modelsDir, "rec.onnx")
        val dictFile = java.io.File(modelsDir, "dict.txt")
        check(detFile.exists() && recFile.exists() && dictFile.exists()) {
            "OCR models missing under ${modelsDir.absolutePath} — run scripts/fetch-models.sh"
        }
        if (detSession.get() == null) {
            val opts = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(4)
                addCPU(true)
            }
            detSession.set(env.createSession(detFile.absolutePath, opts).also { detInput = it.inputNames.first() })
        }
        if (recSession.get() == null) {
            val opts = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(4)
                addCPU(true)
            }
            recSession.set(env.createSession(recFile.absolutePath, opts).also { recInput = it.inputNames.first() })
        }
        if (dict.isEmpty()) {
            dict = dictFile.readLines().filter { it.isNotEmpty() }
        }
    }

    /**
     * Run the full OCR pipeline. Returns boxes in **source-image pixel
     * coordinates** (the pipeline internally downscales and pads, then maps
     * every box back, so callers can use document coordinates directly).
     */
    fun recognize(bitmap: Bitmap, maxSide: Int = 1280): List<OcrBox> {
        ensureSessions()
        val scaled = downscale(bitmap, maxSide)

        // ---------------- detection ----------------
        val detH = round32(scaled.height)
        val detW = round32(scaled.width)
        val padded = padTo(scaled, detW, detH)
        val detProb = runDet(padded, detW, detH)
        val boxes = AiGeometry.dbBoxes(detProb, detW / 4, detH / 4, threshold = 0.3f, unclipRatio = 1.6f)
            .map { b -> AiGeometry.Box(b.x * 4f, b.y * 4f, b.w * 4f, b.h * 4f, b.angleRad) }

        // Detection boxes are in padded coordinates. Map everything back to the
        // source bitmap so the caller gets document-space geometry (uniform
        // scale because padTo only extends, never offsets or distorts).
        val toSourceX = bitmap.width.toFloat() / padded.width.toFloat()
        val toSourceY = bitmap.height.toFloat() / padded.height.toFloat()

        // ---------------- recognition ----------------
        val results = ArrayList<OcrBox>(boxes.size)
        for (box in boxes) {
            val crop = AiGeometry.rotatedCrop(padded, box)
            if (crop.width <= 0 || crop.height <= 0) continue
            val h = 48
            val w = ((crop.width.toFloat() / crop.height.toFloat()) * h).toInt().coerceIn(16, 640)
            val resized = Bitmap.createScaledBitmap(crop, w, h, true)
            val logits = runRec(resized, w, h)
            val (text, conf) = AiGeometry.ctcGreedyDecode(
                logits.first, logits.second, logits.third, dict, useSpace = true
            )
            if (text.isNotBlank() && conf > 0.45f) {
                results.add(
                    OcrBox(
                        text,
                        conf,
                        box.x * toSourceX,
                        box.y * toSourceY,
                        box.w * toSourceX,
                        box.h * toSourceY,
                        box.angleRad,
                    )
                )
            }
        }
        return results
    }

    // ------------------------------------------------------------------ det

    private fun runDet(bmp: Bitmap, w: Int, h: Int): FloatArray {
        val input = FloatBuffer.allocate(1 * 3 * h * w)
        fillTensorCHW(bmp, input, mean = floatArrayOf(0.485f, 0.456f, 0.406f), std = floatArrayOf(0.229f, 0.224f, 0.225f))
        OnnxTensor.createTensor(env, input, longArrayOf(1, 3, h.toLong(), w.toLong())).use { tensor ->
            detSession.get()!!.run(mapOf(detInput to tensor)).use { out ->
                @Suppress("UNCHECKED_CAST")
                val raw = out.get(0).value as Array<Array<Array<FloatArray>>>
                // shape [1,1,H/4,W/4]
                val map = raw[0][0]
                return FloatArray(map.size * map[0].size) { i -> map[i / map[0].size][i % map[0].size] }
            }
        }
    }

    // ------------------------------------------------------------------ rec

    private fun runRec(bmp: Bitmap, w: Int, h: Int): Triple<FloatArray, Int, Int> {
        val input = FloatBuffer.allocate(1 * 3 * h * w)
        fillTensorCHW(bmp, input, mean = floatArrayOf(0.5f, 0.5f, 0.5f), std = floatArrayOf(0.5f, 0.5f, 0.5f))
        OnnxTensor.createTensor(env, input, longArrayOf(1, 3, h.toLong(), w.toLong())).use { tensor ->
            recSession.get()!!.run(mapOf(recInput to tensor)).use { out ->
                val value = out.get(0).value
                // Common export shapes: [1, T, C] or [T, 1, C]
                val (data, seq, classes) = when (value) {
                    is Array<Array<FloatArray>> -> Triple(value[0], value.size, value[0][0].size)
                    is Array<Array<Array<FloatArray>>> -> Triple(
                        Array(value.size) { t -> value[t][0] },
                        value.size,
                        value[0][0][0].size,
                    )
                    else -> error("unexpected rec output shape")
                }
                // flatten [T][C]
                val flat = FloatArray(seq * classes)
                for (t in 0 until seq) System.arraycopy(data[t], 0, flat, t * classes, classes)
                return Triple(flat, seq, classes)
            }
        }
    }

    // ----------------------------------------------------------------- utils

    private fun round32(v: Int): Int = ((v + 31) / 32) * 32

    private fun downscale(src: Bitmap, maxSide: Int): Bitmap {
        val longest = maxOf(src.width, src.height)
        if (longest <= maxSide) return src
        val s = maxSide.toFloat() / longest
        val m = Matrix().apply { postScale(s, s) }
        return Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
    }

    private fun padTo(src: Bitmap, w: Int, h: Int): Bitmap {
        if (src.width == w && src.height == h) return src
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        out.eraseColor(android.graphics.Color.WHITE)
        val c = android.graphics.Canvas(out)
        c.drawBitmap(src, 0f, 0f, null)
        return out
    }

    /** Fill a CHW float buffer with normalized RGB values from the bitmap. */
    private fun fillTensorCHW(bmp: Bitmap, dst: FloatBuffer, mean: FloatArray, std: FloatArray) {
        val w = bmp.width
        val h = bmp.height
        val pixels = IntArray(w * h)
        bmp.getPixels(pixels, 0, w, 0, 0, w, h)
        val plane = w * h
        val r = FloatArray(plane)
        val g = FloatArray(plane)
        val b = FloatArray(plane)
        for (i in 0 until plane) {
            val p = pixels[i]
            r[i] = ((p shr 16 and 0xFF) / 255f - mean[0]) / std[0]
            g[i] = ((p shr 8 and 0xFF) / 255f - mean[1]) / std[1]
            b[i] = ((p and 0xFF) / 255f - mean[2]) / std[2]
        }
        dst.put(r); dst.put(g); dst.put(b)
        dst.rewind()
    }

    fun close() {
        detSession.getAndSet(null)?.close()
        recSession.getAndSet(null)?.close()
    }
}
