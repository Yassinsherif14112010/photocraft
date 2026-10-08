package com.photocraft.mobile.ai

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Base64
import java.util.concurrent.Executors

/**
 * RN module: local background removal (BiRefNet Lite).
 * `quick` runs at 512-effective side (fast preview), `hq` at full 1024.
 * The caller receives RGBA bytes whose alpha is the subject matte; the editor
 * pushes them into the document through the engine as a real raster layer and
 * layer mask (mask.fromAlpha) — persistent, undoable, PSD-exportable.
 */
@ReactModule(name = BackgroundRemovalModule.NAME)
class BackgroundRemovalModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "BackgroundRemoval"
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

    /** RemoveBackgroundQuick — lower-cost preview pass. */
    @ReactMethod
    fun removeBackgroundQuick(image: String, promise: Promise) = run(image, promise)

    /** RemoveBackgroundHQ — full 1024 matting pass. */
    @ReactMethod
    fun removeBackgroundHQ(image: String, promise: Promise) = run(image, promise)

    private fun run(image: String, promise: Promise) {
        executor.execute {
            try {
                val src = decode(image)
                val cutout = engine.removeBackground(src)
                val rgba = ByteArray(cutout.byteCount)
                cutout.copyPixelsToBuffer(java.nio.ByteBuffer.wrap(rgba))
                val out = Arguments.createMap()
                out.putString("rgba", Base64.getEncoder().encodeToString(rgba))
                out.putInt("width", cutout.width)
                out.putInt("height", cutout.height)
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("BG_REMOVAL", e.message ?: "background removal failed", e)
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
