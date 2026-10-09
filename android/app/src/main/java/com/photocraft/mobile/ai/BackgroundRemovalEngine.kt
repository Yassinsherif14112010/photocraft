package com.photocraft.mobile.ai

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import java.nio.FloatBuffer
import java.util.concurrent.atomic.AtomicReference

/**
 * On-device background removal with BiRefNet Lite (1024×1024, single-class SOD).
 * 100% local inference through ONNX Runtime; the resulting alpha matte becomes a
 * real PhotoCraft layer mask through the engine (`mask.fromAlpha`), exactly like
 * "Select Subject" — never a placeholder overlay.
 */
class BackgroundRemovalEngine(context: Context) {

    companion object {
        const val INPUT_SIZE = 1024
        private val MEAN = floatArrayOf(0.485f, 0.456f, 0.406f)
        private val STD = floatArrayOf(0.229f, 0.224f, 0.225f)
    }

    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val session = AtomicReference<OrtSession?>(null)
    private var inputName: String = "input_image"

    private val modelFile get() = java.io.File(context.filesDir, "models/birefnet/BiRefNet-lite-1024.onnx")

    fun isReady(): Boolean = modelFile.exists()

    private fun ensureSession() {
        if (session.get() == null) {
            check(modelFile.exists()) {
                "BiRefNet Lite model missing at ${modelFile.absolutePath} — run scripts/fetch-models.sh"
            }
            val opts = OrtSession.SessionOptions().apply {
                setIntraOpNumThreads(4)
                addCPU(true)
            }
            session.set(env.createSession(modelFile.absolutePath, opts).also { inputName = it.inputNames.first() })
        }
    }

    /**
     * Run matting and return an ARGB bitmap whose alpha channel is the predicted
     * subject mask (colours preserved from the source at full resolution — the
     * square network output is bilinearly restored to the source aspect, so
     * non-square images are never squashed). Caller applies it to the document
     * as a cutout or a layer mask. `inputSize` picks the network input
     * (512 for the quick preview, 1024 for HQ).
     */
    fun removeBackground(src: Bitmap, inputSize: Int = INPUT_SIZE): Bitmap {
        val matte = matteOf(src, inputSize)
        val full = MatteRefine.resample(matte, inputSize, src.width, src.height)
        return MatteRefine.composeFullRes(src, full)
    }

    /** Extract the raw matte (0..1, row-major, inputSize×inputSize). */
    fun matteOf(src: Bitmap, inputSize: Int = INPUT_SIZE): FloatArray {
        ensureSession()
        val size = if (inputSize == INPUT_SIZE) INPUT_SIZE else inputSize.coerceIn(64, INPUT_SIZE)
        val resized = Bitmap.createScaledBitmap(src, size, size, true)
        val buffer = FloatBuffer.allocate(1 * 3 * size * size)
        fillCHW(resized, buffer)
        OnnxTensor.createTensor(
            env, buffer, longArrayOf(1, 3, size.toLong(), size.toLong())
        ).use { tensor ->
            session.get()!!.run(mapOf(inputName to tensor)).use { out ->
                val value = out.get(0).value
                return when (value) {
                    is Array<Array<Array<FloatArray>>> -> sigmoid(value[0][0])
                    is Array<FloatArray> -> sigmoid(value)
                    else -> error("unexpected BiRefNet output shape")
                }
            }
        }
    }

    /** Extract the raw matte (0..1) as a grayscale ARGB bitmap (for mask previews). */
    fun mattePreview(src: Bitmap): Bitmap {
        val matteMatte = matteOf(src, INPUT_SIZE)
        return MatteRefine.preview(matteMatte, INPUT_SIZE)
    }

    private fun sigmoid(map: FloatArray): FloatArray {
        val out = FloatArray(map.size)
        for (i in out.indices) out[i] = 1f / (1f + kotlin.math.exp(-map[i]))
        return out
    }

    private fun fillCHW(bmp: Bitmap, dst: FloatBuffer) {
        val pixels = IntArray(bmp.width * bmp.height)
        bmp.getPixels(pixels, 0, bmp.width, 0, 0, bmp.width, bmp.height)
        val plane = pixels.size
        val r = FloatArray(plane)
        val g = FloatArray(plane)
        val b = FloatArray(plane)
        for (i in 0 until plane) {
            val p = pixels[i]
            r[i] = ((p shr 16 and 0xFF) / 255f - MEAN[0]) / STD[0]
            g[i] = ((p shr 8 and 0xFF) / 255f - MEAN[1]) / STD[1]
            b[i] = ((p and 0xFF) / 255f - MEAN[2]) / STD[2]
        }
        dst.put(r); dst.put(g); dst.put(b)
        dst.rewind()
    }

    fun close() {
        session.getAndSet(null)?.close()
    }
}
