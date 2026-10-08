package com.photocraft.mobile.ai

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.Base64
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * RN module: local background removal (BiRefNet Lite).
 * `quick` runs the network at 512² (fast preview matte), `hq` at the full
 * 1024². Refinement (threshold / edge smoothing / feather / edge shift) is
 * applied to the raw matte before the reply. When `saveAs` is given, the
 * cutout is written as a PNG so the editor can place it through the engine
 * (`file.placeEmbedded`) and turn its alpha into a real layer mask
 * (`layer.layerMask.fromAlpha`) — persistent, undoable, PSD-exportable.
 * `mattePreview` returns a grayscale PNG of the refined matte without
 * touching the document.
 */
@ReactModule(name = BackgroundRemovalModule.NAME)
class BackgroundRemovalModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "BackgroundRemoval"
        private const val QUICK_INPUT = 512
        private const val HQ_INPUT = BackgroundRemovalEngine.INPUT_SIZE
    }

    private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "photocraft-bgremoval") }
    private val engine by lazy { BackgroundRemovalEngine(reactContext) }

    override fun getName() = NAME

    override fun invalidate() {
        engine.close()
        executor.shutdownNow()
        super.invalidate()
    }

    @ReactMethod
    fun isModelReady(promise: Promise) = promise.resolve(engine.isReady())

    @ReactMethod
    fun modelsDir(promise: Promise) = promise.resolve(
        File(reactContext.filesDir, "models/birefnet").absolutePath
    )

    /**
     * AI matting with options:
     * `{"mode":"quick"|"hq","threshold":0..1,"edgeSmooth":0..8,"feather":0..8,
     *   "shiftEdge":-1..1,"saveAs":path?}`.
     * Reply: `{rgba, width, height, savedAs?}`.
     */
    @ReactMethod
    fun removeBackground(image: String, optionsJson: String, promise: Promise) {
        executor.execute {
            try {
                val opts = JSONObject(optionsJson.ifBlank { "{}" })
                val mode = opts.optString("mode", "hq")
                val input = if (mode == "quick") QUICK_INPUT else HQ_INPUT
                val threshold = opts.optDouble("threshold", 0.0).toFloat().coerceIn(0f, 1f)
                val edgeSmooth = opts.optDouble("edgeSmooth", 1.0).toFloat().coerceIn(0f, 8f)
                val feather = opts.optDouble("feather", 0.0).toFloat().coerceIn(0f, 8f)
                val shiftEdge = opts.optDouble("shiftEdge", 0.0).toFloat().coerceIn(-1f, 1f)

                val src = decode(image)
                val matte = engine.matteOf(src, input)
                val refined = MatteRefine.refine(matte, input, threshold, edgeSmooth, feather, shiftEdge)
                val cutout = MatteRefine.compose(src, refined, input)

                var savedAs: String? = null
                val saveAs = opts.optString("saveAs", "").ifBlank { null }
                if (saveAs != null) {
                    val out = File(saveAs).apply { parentFile?.mkdirs() }
                    FileOutputStream(out).use { fos ->
                        cutout.compress(Bitmap.CompressFormat.PNG, 100, fos)
                    }
                    savedAs = out.absolutePath
                }

                val rgba = ByteArray(cutout.byteCount)
                cutout.copyPixelsToBuffer(java.nio.ByteBuffer.wrap(rgba))
                val out = Arguments.createMap()
                out.putString("rgba", Base64.getEncoder().encodeToString(rgba))
                out.putInt("width", cutout.width)
                out.putInt("height", cutout.height)
                if (savedAs != null) out.putString("savedAs", savedAs)
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("BG_REMOVAL", e.message ?: "background removal failed", e)
            }
        }
    }

    /** Grayscale matte preview PNG (data URL). Same options as removeBackground. */
    @ReactMethod
    fun mattePreview(image: String, optionsJson: String, promise: Promise) {
        executor.execute {
            try {
                val opts = JSONObject(optionsJson.ifBlank { "{}" })
                val mode = opts.optString("mode", "hq")
                val input = if (mode == "quick") QUICK_INPUT else HQ_INPUT
                val src = decode(image)
                val matte = engine.matteOf(src, input)
                val refined = MatteRefine.refine(
                    matte, input,
                    opts.optDouble("threshold", 0.0).toFloat().coerceIn(0f, 1f),
                    opts.optDouble("edgeSmooth", 1.0).toFloat().coerceIn(0f, 8f),
                    opts.optDouble("feather", 0.0).toFloat().coerceIn(0f, 8f),
                    opts.optDouble("shiftEdge", 0.0).toFloat().coerceIn(-1f, 1f),
                )
                val bmp = MatteRefine.preview(refined, input)
                val png = ByteArrayOutputStream()
                bmp.compress(Bitmap.CompressFormat.PNG, 90, png)
                val b64 = Base64.getEncoder().encodeToString(png.toByteArray())
                val out = Arguments.createMap()
                out.putString("preview", "data:image/png;base64,$b64")
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("BG_PREVIEW", e.message ?: "matte preview failed", e)
            }
        }
    }

    private fun decode(dataUrl: String): Bitmap {
        val base64 = dataUrl.substringAfter("base64,", dataUrl)
        val bytes = Base64.getDecoder().decode(base64)
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: error("unsupported image payload")
    }
}
