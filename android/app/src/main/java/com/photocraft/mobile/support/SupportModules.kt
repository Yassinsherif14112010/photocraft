package com.photocraft.mobile.support

import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.File

/**
 * Small real file-IO surface for the JS layer: brand-kit import/export,
 * JSON payloads and document-picker imports. Files live in app storage
 * (filesDir / cacheDir); nothing here trusts remote input — paths are
 * resolved inside the app's own dirs.
 */
@ReactModule(name = FileTextModule.NAME)
class FileTextModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "FileText"
    }

    override fun getName() = NAME

    private fun resolve(path: String): File {
        val f = File(path)
        val root = reactContext.filesDir.canonicalPath
        val cache = reactContext.cacheDir.canonicalPath
        val canonical = f.canonicalFile.absolutePath
        require(canonical.startsWith(root) || canonical.startsWith(cache)) {
            "path escapes app storage: $path"
        }
        return f
    }

    @ReactMethod
    fun writeTextFile(path: String, contents: String, promise: Promise) {
        try {
            val f = resolve(path).apply { parentFile?.mkdirs() }
            f.writeText(contents, Charsets.UTF_8)
            promise.resolve(true)
        } catch (e: Throwable) {
            promise.reject("WRITE", e.message, e)
        }
    }

    @ReactMethod
    fun readTextFile(path: String, promise: Promise) {
        try {
            promise.resolve(resolve(path).readText(Charsets.UTF_8))
        } catch (e: Throwable) {
            promise.reject("READ", e.message, e)
        }
    }

    /** Copy a picked content:// Uri into cacheDir with a safe name. */
    @ReactMethod
    fun copyUriToCache(uri: String, name: String, promise: Promise) {
        try {
            val safe = name.replace(Regex("[^\\w.\\u0600-\\u06FF-]"), "_").ifBlank { "import" }
            val out = File(reactContext.cacheDir, safe)
            reactContext.contentResolver.openInputStream(Uri.parse(uri))?.use { input ->
                out.outputStream().use { output -> input.copyTo(output) }
            } ?: error("cannot open $uri")
            promise.resolve(out.absolutePath)
        } catch (e: Throwable) {
            promise.reject("COPY", e.message, e)
        }
    }
}

/** Reads bundled asset files (asset-library SVGs) as UTF-8 text. */
@ReactModule(name = AssetsModule.NAME)
class AssetsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "PhotoCraftAssets"
    }

    override fun getName() = NAME

    @ReactMethod
    fun readAsset(path: String, promise: Promise) {
        try {
            // Only plain asset paths — reject anything that tries to climb out.
            require(!path.contains("..")) { "bad asset path" }
            val bytes = reactContext.assets.open(path).use { it.readBytes() }
            promise.resolve(String(bytes, Charsets.UTF_8))
        } catch (e: Throwable) {
            promise.reject("ASSET", e.message, e)
        }
    }
}
