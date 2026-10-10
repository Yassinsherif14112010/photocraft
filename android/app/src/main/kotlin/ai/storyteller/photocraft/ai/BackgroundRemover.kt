package ai.storyteller.photocraft.ai

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import java.util.Collections
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

/** A grayscale alpha mask in *document pixel* coordinates: one byte per pixel, 255 = keep. */
data class AlphaMask(val width: Int, val height: Int, val bytes: ByteArray) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is AlphaMask) return false
        return width == other.width && height == other.height && bytes.contentEquals(other.bytes)
    }

    override fun hashCode(): Int = (31 * width + height) * 31 + bytes.contentHashCode()
}

/** The outcome of one background-removal run. */
data class RemovalResult(
    val mask: AlphaMask,
    val modelId: String,
    /** Inference time excluding preprocessing, in milliseconds. */
    val inferenceMs: Long,
    /** Total wall time including preprocessing and mask compositing, in milliseconds. */
    val totalMs: Long
)

/**
 * Thrown for every failure the user can act on: a missing model, a corrupt model, a model that
 * does not fit in memory, a cancelled run.
 */
class RemovalException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * On-device background removal with ONNX Runtime.
 *
 * It runs the BiRefNet / U²-Net ONNX models listed in the manifest. The contract:
 *
 *  * **Never on the main thread.** [removeBackground] is a `suspend` on [Dispatchers.Default].
 *  * **Aspect ratio is preserved.** The image is letterboxed into the model's square input; the
 *    padding is cropped back off and only then is the mask scaled to the layer's real size, so a
 *    portrait photo never comes back squeezed into a square.
 *  * **Cancellation is honoured.** [isCancelled] is polled between every step; a cancelled run
 *    returns `null` and touches nothing.
 *  * **Nothing is mutated.** It returns a mask; the caller decides (and the engine applies it as a
 *    non-destructive layer mask). The live document is never resized for a preview.
 *  * **Sessions are closed exactly once** and never used afterwards; every tensor is closed in a
 *    `finally`.
 */
class BackgroundRemover(context: Context) : AutoCloseable {

    private val appContext = context.applicationContext
    private val closed = AtomicBoolean(false)

    @Volatile
    private var environment: OrtEnvironment? = null

    @Volatile
    private var session: OrtSession? = null

    @Volatile
    private var loadedModel: String? = null

    /** Serialises inference: two concurrent sessions would double the peak memory for nothing. */
    private val lock = Any()

    // ---- session lifecycle --------------------------------------------------

    /**
     * Opens the model. Uses the NNAPI execution provider when the device has one, and falls back to
     * the CPU provider otherwise (never silently: the log says which one was chosen).
     */
    suspend fun load(spec: ModelSpec, file: File) = withContext(Dispatchers.Default) {
        if (closed.get()) throw RemovalException("the remover has been closed")
        if (loadedModel == spec.id) return@withContext
        if (!file.isFile) throw RemovalException("the model ${spec.file} is not on the device yet")
        val needed = requiredMemoryBytes(file.length())
        if (needed > availableMemoryBytes()) {
            throw RemovalException(
                "not enough memory for ${spec.label}: it needs about ${needed / 1_000_000} MB and " +
                    "this device has ${availableMemoryBytes() / 1_000_000} MB free. " +
                    "Use Quick Remove (no model) or the balanced model instead."
            )
        }
        closeSession()
        val env = OrtEnvironment.getEnvironment()
        val options = OrtSession.SessionOptions().apply {
            setIntraOpNumThreads(max(1, min(4, Runtime.getRuntime().availableProcessors() - 1)))
            try {
                addNnapi(android.util.Build.SUPPORTED_ABIS.contains("arm64-v8a"))
            } catch (e: Exception) {
                android.util.Log.i(TAG, "NNAPI is unavailable on this device (${e.message}); using the CPU provider")
            }
        }
        val opened = try {
            env.createSession(file.absolutePath, options)
        } catch (e: Exception) {
            throw RemovalException("${spec.label} could not be opened: ${e.message}. It may be corrupt — download it again.", e)
        } finally {
            options.close()
        }
        synchronized(lock) {
            environment = env
            session = opened
            loadedModel = spec.id
        }
        android.util.Log.i(TAG, "loaded ${spec.id} (inputs: ${opened.inputNames.joinToString()})")
    }

    /**
     * Runs the model on [bitmap] and returns the subject mask at [outWidth] × [outHeight]
     * (the layer's real pixel size — usually the document size).
     *
     * @return `null` when [isCancelled] turned true; nothing was changed either way.
     */
    suspend fun removeBackground(
        bitmap: Bitmap,
        outWidth: Int,
        outHeight: Int,
        isCancelled: () -> Boolean = { false }
    ): RemovalResult? = withContext(Dispatchers.Default) {
        val started = System.currentTimeMillis()
        val (env, sess, modelId) = synchronized(lock) {
            Triple(environment, session, loadedModel)
        }
        if (sess == null || env == null) throw RemovalException("no model is loaded")
        if (closed.get()) throw RemovalException("the remover has been closed")

        // 1. The real input shape: prefer what the graph declares over the manifest's hint.
        val inputName = sess.inputNames.firstOrNull()
            ?: throw RemovalException("the model declares no input")
        val inputShape = (sess.inputInfo[inputName]?.info as? ai.onnxruntime.TensorInfo)?.shape
        val side = staticSquareSide(inputShape) ?: DEFAULT_INPUT_SIDE
        if (isCancelled()) return@withContext null

        // 2. Letterbox: scale into a square canvas without changing the aspect ratio.
        val (scaled, padLeft, padTop, scale) = letterbox(bitmap, side)
        if (isCancelled()) return@withContext null

        // 3. Preprocess to NCHW float32, ImageNet normalisation.
        val pixels = IntArray(side * side)
        scaled.getPixels(pixels, 0, side, 0, 0, side, side)
        if (scaled !== bitmap) scaled.recycle()
        val floats = FloatArray(side * side * 3)
        for (i in 0 until side * side) {
            val p = pixels[i]
            floats[i] = (((p shr 16) and 0xFF) / 255f - MEAN[0]) / STD[0]
            floats[side * side + i] = (((p shr 8) and 0xFF) / 255f - MEAN[1]) / STD[1]
            floats[2 * side * side + i] = ((p and 0xFF) / 255f - MEAN[2]) / STD[2]
        }
        if (isCancelled()) return@withContext null

        // 4. Inference.
        val raw = FloatArray(side * side)
        val inferenceMs = measureMs {
            val tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(floats), longArrayOf(1, 3, side.toLong(), side.toLong()))
            try {
                sess.run(Collections.singletonMap(inputName, tensor)).use { result ->
                    val out = result.firstOrNull()?.value as? OnnxTensor
                        ?: throw RemovalException("the model produced no mask output")
                    val buffer = out.floatBuffer
                    val count = min(buffer.remaining(), side * side)
                    buffer.get(raw, 0, count)
                }
            } finally {
                tensor.close()
            }
        }
        if (isCancelled()) return@withContext null

        // 5. Postprocess: sigmoid when the model emits logits, clamp when it is already 0..1.
        val probabilities = toProbabilities(raw)
        if (isCancelled()) return@withContext null

        // 6. Undo the letterbox: crop the padding off, then scale to the layer's real size.
        val maskBitmap = maskBitmap(probabilities, side)
        val cropped = Bitmap.createBitmap(maskBitmap, padLeft, padTop, scale.first, scale.second)
        if (maskBitmap !== cropped) maskBitmap.recycle()
        val resized = Bitmap.createScaledBitmap(cropped, outWidth, outHeight, true)
        if (cropped !== resized) cropped.recycle()
        val bytes = alphaBytes(resized)
        resized.recycle()

        RemovalResult(
            mask = AlphaMask(outWidth, outHeight, bytes),
            modelId = modelId ?: "unknown",
            inferenceMs = inferenceMs,
            totalMs = System.currentTimeMillis() - started
        )
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) closeSession()
    }

    private fun closeSession() {
        synchronized(lock) {
            try {
                session?.close()
            } catch (e: Exception) {
                android.util.Log.w(TAG, "closing the session failed: ${e.message}")
            }
            session = null
            loadedModel = null
            // The environment is process-wide in ONNX Runtime; it is released with the session.
            environment = null
        }
    }

    // ---- geometry -----------------------------------------------------------

    private data class Letterbox(
        val bitmap: Bitmap,
        val padLeft: Int,
        val padTop: Int,
        val size: Pair<Int, Int>
    )

    /**
     * Scales [source] into a `side`×`side` canvas, preserving the aspect ratio and centring it.
     * Everything outside the subject is zero padding, which is cropped off again in step 6.
     */
    private fun letterbox(source: Bitmap, side: Int): Letterbox {
        val w = source.width
        val h = source.height
        val scale = min(side.toFloat() / w.toFloat(), side.toFloat() / h.toFloat())
        val targetW = max(1, (w * scale).toInt().coerceAtMost(side))
        val targetH = max(1, (h * scale).toInt().coerceAtMost(side))
        val scaled = if (targetW == w && targetH == h) source else Bitmap.createScaledBitmap(source, targetW, targetH, true)
        if (scaled.width == side && scaled.height == side) return Letterbox(scaled, 0, 0, scaled.width to scaled.height)
        val canvas = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
        android.graphics.Canvas(canvas).apply {
            drawColor(android.graphics.Color.TRANSPARENT)
            drawBitmap(scaled, ((side - scaled.width) / 2f), ((side - scaled.height) / 2f), null)
        }
        if (scaled !== source) scaled.recycle()
        return Letterbox(canvas, (side - targetW) / 2, (side - targetH) / 2, targetW to targetH)
    }

    /** Reads the static spatial size of an NCHW input, or `null` when the graph is dynamic. */
    private fun staticSquareSide(shape: LongArray?): Int? {
        if (shape == null || shape.size != 4) return null
        val h = shape[2]
        val w = shape[3]
        if (h <= 0 || w <= 0 || h != w) return null
        return h.toInt().coerceIn(64, 4096)
    }

    private fun toProbabilities(raw: FloatArray): FloatArray {
        var min = Float.POSITIVE_INFINITY
        var max = Float.NEGATIVE_INFINITY
        for (v in raw) {
            if (v < min) min = v
            if (v > max) max = v
        }
        val out = FloatArray(raw.size)
        if (min < -0.5f || max > 1.5f) {
            // The model emits logits (U²-Net does): squash them into 0..1.
            for (i in raw.indices) out[i] = (1f / (1f + kotlin.math.exp(-raw[i])))
        } else {
            for (i in raw.indices) out[i] = raw[i].coerceIn(0f, 1f)
        }
        return out
    }

    /** One byte per pixel, in [Bitmap.Config.ALPHA_8] order, honouring the bitmap's row stride. */
    private fun alphaBytes(bitmap: Bitmap): ByteArray {
        val rowBytes = bitmap.rowBytes
        val height = bitmap.height
        val width = bitmap.width
        val buffer = ByteBuffer.allocateDirect(rowBytes * height)
        bitmap.copyPixelsToBuffer(buffer)
        buffer.rewind()
        val out = ByteArray(width * height)
        val row = ByteArray(rowBytes)
        for (y in 0 until height) {
            buffer.get(row, 0, rowBytes)
            System.arraycopy(row, 0, out, y * width, width)
        }
        return out
    }

    private fun maskBitmap(probabilities: FloatArray, side: Int): Bitmap {
        val bytes = ByteArray(side * side)
        for (i in probabilities.indices) {
            bytes[i] = (probabilities[i] * 255f + 0.5f).toInt().coerceIn(0, 255).toByte()
        }
        val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ALPHA_8)
        val buffer = ByteBuffer.wrap(bytes)
        bitmap.copyPixelsFromBuffer(buffer)
        return bitmap
    }

    // ---- memory -------------------------------------------------------------

    /** Rough peak working set: the model, its activations and the float buffers. */
    fun requiredMemoryBytes(modelBytes: Long): Long = (modelBytes * 2.5).toLong() + 96 * 1_000_000L

    private fun availableMemoryBytes(): Long {
        val manager = appContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val info = ActivityManager.MemoryInfo()
        if (manager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            runCatching { manager.getMemoryInfo(info) }
            if (info.availMem > 0) return (info.availMem * 0.6).toLong()
        }
        return Runtime.getRuntime().maxMemory() / 2
    }

    private inline fun measureMs(block: () -> Unit): Long {
        val start = System.currentTimeMillis()
        block()
        return System.currentTimeMillis() - start
    }

    companion object {
        private const val TAG = "BackgroundRemover"
        private const val DEFAULT_INPUT_SIDE = 1024
        /** ImageNet normalisation, which every model in the manifest is trained with. */
        private val MEAN = floatArrayOf(0.485f, 0.456f, 0.406f)
        private val STD = floatArrayOf(0.229f, 0.224f, 0.225f)
    }
}
