package com.photocraft.mobile.ai

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.Base64
import java.util.concurrent.Executors

/**
 * RN module: local PaddleOCR text detection + recognition (Arabic + English).
 * Input images arrive as base64 PNG/JPEG from React; results are OCR boxes with
 * text, confidence and pixel rects so Text Studio can build real text layers
 * (`CreateTextLayerFromOCR`) and persist OCR metadata with the document.
 */
@ReactModule(name = OcrModule.NAME)
class OcrModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "OcrEngine"
    }

    private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "photocraft-ocr") }
    private val engine by lazy { OcrEngine(reactContext) }

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
        File(reactContext.filesDir, "models/ocr").absolutePath
    )

    /**
     * `detect + recognize` in one call.
     * `image` = data URL or bare base64 (PNG/JPEG/WebP — anything BitmapFactory reads).
     * Reply: `{ "boxes": [ {text, confidence, x, y, w, h, angle} ] }`
     */
    @ReactMethod
    fun detectAndRecognize(image: String, promise: Promise) {
        executor.execute {
            try {
                val bmp = decode(image)
                val results = engine.recognize(bmp)
                val arr = JSONArray()
                for (r in results) {
                    arr.put(
                        JSONObject()
                            .put("text", r.text)
                            .put("confidence", r.confidence.toDouble())
                            .put("x", r.x.toDouble())
                            .put("y", r.y.toDouble())
                            .put("w", r.w.toDouble())
                            .put("h", r.h.toDouble())
                            .put("angle", r.angleRad.toDouble())
                    )
                }
                val out = Arguments.createMap()
                out.putString("boxes", arr.toString())
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("OCR", e.message ?: "OCR failed", e)
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
