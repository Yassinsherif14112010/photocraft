package com.photocraft.mobile.engine

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.LruCache
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * The single React Native door into the PhotoCraft engine.
 *
 * Every editor operation — document creation, layers, groups, masks, blend modes,
 * the ten layer styles, Text Studio (incl. RTL/Arabic shaping), SVG import/export,
 * PSD/PSB save/load, and PNG/JPEG/WebP export — goes through the engine's own
 * command registry (the same commands the desktop app and CLI use). This module
 * deliberately exposes *that* JSON surface instead of re-implementing any of it
 * in Java/Kotlin, so mobile behaviour matches upstream PhotoCraft exactly.
 */
@ReactModule(name = PhotoCraftModule.NAME)
class PhotoCraftModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "PhotoCraftEngine"

        /** Commands that do not change pixels — executing them must not
         *  invalidate the cached composite (selection, hit-testing, reads). */
        private val NON_MUTATING = setOf("layer.select", "layer.pickAt")
        private val SESSION_ID = AtomicLong(1)
    }

    private val engine = Executors.newSingleThreadExecutor { r -> Thread(r, "photocraft-engine") }

    /** Documents opened from React: sessionId -> native session handle. */
    private val sessions = HashMap<Long, Long>()

    private val pngCache = object : LruCache<String, ByteArray>(48) {}

    // ------------------------------------------------------------------ misc

    override fun getName() = NAME

    override fun invalidate() {
        // Freeing a native session while a queued task is still executing it
        // would be a use-after-free. Let the queue drain first (bounded), then
        // free. If it cannot drain in time, prefer a bounded native leak over
        // a crash — the dying process reclaims it.
        engine.shutdown()
        val drained = try {
            engine.awaitTermination(4, TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
            false
        }
        if (drained) {
            synchronized(sessions) {
                sessions.values.forEach { PhotoCraftJni.nativeSessionFree(it) }
                sessions.clear()
            }
        }
        synchronized(pngCache) { pngCache.evictAll() }
        super.invalidate()
    }

    private fun respond(promise: Promise, json: String) {
        val map: WritableMap = Arguments.createMap()
        val obj = JSONObject(json)
        if (obj.has("error")) {
            map.putString("error", obj.getString("error"))
        } else {
            map.putString("result", json)
        }
        promise.resolve(map)
    }

    private fun requireSession(id: Long): Long {
        val handle = synchronized(sessions) { sessions[id] }
        require(handle != null && handle != 0L) { "unknown session $id" }
        return handle
    }

    /** App-storage containment — shared by every path-taking entry point. */
    private fun requireAppPath(path: String): File {
        val f = File(path)
        val root = reactApplicationContext.filesDir.canonicalPath
        val cache = reactApplicationContext.cacheDir.canonicalPath
        val canonical = f.canonicalFile.absolutePath
        require(canonical.startsWith(root) || canonical.startsWith(cache)) {
            "path escapes app storage"
        }
        return f
    }

    // -------------------------------------------------------------- lifecycle

    @ReactMethod
    fun version(promise: Promise) {
        engine.execute { promise.resolve(PhotoCraftJni.nativeVersion()) }
    }

    @ReactMethod
    fun engineCommands(promise: Promise) {
        engine.execute {
            try {
                val id = SESSION_ID.getAndIncrement()
                val handle = PhotoCraftJni.nativeSessionNew()
                if (handle == 0L) error("engine session allocation failed")
                synchronized(sessions) { sessions[id] = handle }
                val out = Arguments.createMap()
                out.putDouble("sessionId", id.toDouble())
                out.putString("commands", PhotoCraftJni.nativeCommandList(handle))
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("ENGINE", e.message ?: "session allocation failed", e)
            }
        }
    }

    @ReactMethod
    fun closeSession(sessionId: Double, promise: Promise) {
        engine.execute {
            val id = sessionId.toLong()
            val handle = synchronized(sessions) { sessions.remove(id) }
            if (handle != null) PhotoCraftJni.nativeSessionFree(handle)
            synchronized(pngCache) { pngCache.evictAll() }
            promise.resolve(true)
        }
    }

    // ------------------------------------------------------- engine RPC door

    /** Run one automation method. `params` is the raw JSON params object. */
    @ReactMethod
    fun call(sessionId: Double, method: String, params: ReadableMap, promise: Promise) {
        engine.execute {
            try {
                val handle = requireSession(sessionId.toLong())
                val paramsJson = if (params != null) {
                    JSONObject(params.toHashMap()).toString()
                } else {
                    "{}"
                }
                respond(promise, PhotoCraftJni.nativeCall(handle, method, paramsJson))
            } catch (e: Exception) {
                promise.reject("ENGINE", e.message ?: "engine call failed", e)
            }
        }
    }

    /** Convenience: `engine.execute` with command + params. */
    @ReactMethod
    fun execute(sessionId: Double, command: String, params: ReadableMap, promise: Promise) {
        executeInternal(sessionId, command, params, invalidateCache = true, promise = promise)
    }

    /**
     * Execute with explicit cache control: `invalidateCache=false` skips the
     * composite-cache eviction for commands that cannot change pixels
     * (selection, hit-testing) so the canvas is not needlessly re-rendered.
     */
    @ReactMethod
    fun executeNoInvalidate(sessionId: Double, command: String, params: ReadableMap, promise: Promise) {
        executeInternal(sessionId, command, params, invalidateCache = false, promise = promise)
    }

    private fun executeInternal(
        sessionId: Double,
        command: String,
        params: ReadableMap,
        invalidateCache: Boolean,
        promise: Promise,
    ) {
        engine.execute {
            try {
                val handle = requireSession(sessionId.toLong())
                val cmdParams = if (params != null) JSONObject(params.toHashMap()) else JSONObject()
                val body = JSONObject()
                    .put("command", command)
                    .put("params", cmdParams)
                val reply = PhotoCraftJni.nativeCall(handle, "engine.execute", body.toString())
                // Mutations change the composite — stale cached renders must not
                // survive a successful execute (canvas + thumbnails re-render).
                val mustInvalidate = invalidateCache && !NON_MUTATING.contains(command)
                if (mustInvalidate && !JSONObject(reply).has("error")) {
                    synchronized(pngCache) { pngCache.evictAll() }
                }
                respond(promise, reply)
            } catch (e: Exception) {
                promise.reject("ENGINE", e.message ?: "engine execute failed", e)
            }
        }
    }

    // ---------------------------------------------------------- file I/O glue

    /**
     * Read a file from app storage as base64 (staged inbox images for the
     * AI panels). Paths outside filesDir/cacheDir are rejected.
     */
    @ReactMethod
    fun readFileBase64(path: String, promise: Promise) {
        engine.execute {
            try {
                val f = File(path)
                val root = reactApplicationContext.filesDir.canonicalPath
                val cache = reactApplicationContext.cacheDir.canonicalPath
                val canonical = f.canonicalFile.absolutePath
                require(canonical.startsWith(root) || canonical.startsWith(cache)) {
                    "path escapes app storage"
                }
                val bytes = f.readBytes()
                promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
            } catch (e: Exception) {
                promise.reject("READ", e.message, e)
            }
        }
    }


    /**
     * Open a document from a local file (PSD/PSB/PNG/JPEG/WebP/SVG/.pcraft — anything
     * the engine imports). The engine parses it; warnings come back in the reply.
     * The path must live in app storage (the picker staging area is inside cacheDir).
     */
    @ReactMethod
    fun openDocument(sessionId: Double, path: String, promise: Promise) {
        engine.execute {
            try {
                requireAppPath(path)
                val handle = requireSession(sessionId.toLong())
                val body = JSONObject().put("path", path)
                val reply = PhotoCraftJni.nativeCall(handle, "doc.open", body.toString())
                // A different document is now active in this session — the old
                // cached composite must not survive the switch.
                if (!JSONObject(reply).has("error")) {
                    synchronized(pngCache) { pngCache.evictAll() }
                }
                respond(promise, reply)
            } catch (e: Exception) {
                promise.reject("OPEN", e.message, e)
            }
        }
    }

    /**
     * Save/export the active document. `format` is an extension like
     * "psd", "psb", "png", "jpg", "webp", "pcraft". Writes to `path` (cache/export dir).
     */
    @ReactMethod
    fun saveDocument(sessionId: Double, path: String, format: String, quality: Int, promise: Promise) {
        engine.execute {
            try {
                requireAppPath(path)
                val handle = requireSession(sessionId.toLong())
                val body = JSONObject()
                    .put("path", path)
                    .put("format", format)
                    .put("quality", quality.coerceIn(1, 100))
                respond(promise, PhotoCraftJni.nativeCall(handle, "doc.save", body.toString()))
            } catch (e: Exception) {
                promise.reject("SAVE", e.message, e)
            }
        }
    }

    // ------------------------------------------------------------- rendering

    /**
     * Render the flattened composite and return a base64 PNG for React components
     * (thumbnails, panels). The fast RGBA path used by the SurfaceView canvas lives
     * in [CanvasView] and calls the JNI directly to avoid base64 overhead.
     */
    @ReactMethod
    fun renderThumbnail(sessionId: Double, maxSide: Int, promise: Promise) {
        engine.execute {
            try {
                val handle = requireSession(sessionId.toLong())
                val key = "$sessionId:$maxSide"
                val cached = synchronized(pngCache) { pngCache.get(key) }
                val png = cached ?: run {
                    val sizes = LongArray(3)
                    val rgba = PhotoCraftJni.nativeRenderRgba(handle, maxSide, sizes)
                    if (rgba.isEmpty() || sizes[1] <= 0 || sizes[2] <= 0) error("render failed")
                    val encoded = PhotoCraftJni.nativeRgba8ToPng(rgba, sizes[1].toInt(), sizes[2].toInt())
                    if (encoded.isEmpty()) error("thumbnail encoding failed")
                    synchronized(pngCache) { pngCache.put(key, encoded) }
                    encoded
                }
                val b64 = Base64.encodeToString(png, Base64.NO_WRAP)
                promise.resolve("data:image/png;base64,$b64")
            } catch (e: Exception) {
                promise.reject("RENDER", e.message, e)
            }
        }
    }

    /** Real file size in bytes (export verification: a 0-byte export is a failure). */
    @ReactMethod
    fun fileSize(path: String, promise: Promise) {
        engine.execute {
            try {
                val f = requireAppPath(path)
                promise.resolve(if (f.exists()) f.length().toDouble() else -1.0)
            } catch (e: Exception) {
                promise.reject("STAT", e.message, e)
            }
        }
    }

    /** Decode helper used by the AI modules when they need a Bitmap from RGBA bytes. */
    fun rgbaToBitmap(rgba: ByteArray, width: Int, height: Int): Bitmap {
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bmp.copyPixelsFromBuffer(java.nio.ByteBuffer.wrap(rgba))
        return bmp
    }

    fun bitmapToPngBytes(bitmap: Bitmap): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        return out.toByteArray()
    }

    fun decodePng(bytes: ByteArray): Bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)

    fun cacheDir(): File = reactApplicationContext.cacheDir
    fun filesDir(): File = reactApplicationContext.filesDir
}
