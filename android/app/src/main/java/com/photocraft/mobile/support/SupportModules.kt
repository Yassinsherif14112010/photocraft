package com.photocraft.mobile.support

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Base64
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
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

    /** Write binary data (base64, NO_WRAP) — used for engine-rendered thumbnails. */
    @ReactMethod
    fun writeBase64File(path: String, base64: String, promise: Promise) {
        try {
            val f = resolve(path).apply { parentFile?.mkdirs() }
            val data = Base64.decode(base64, Base64.NO_WRAP)
            f.writeBytes(data)
            promise.resolve(true)
        } catch (e: Throwable) {
            promise.reject("WRITE", e.message, e)
        }
    }

    /** Delete a file inside app storage (projects, thumbnails, imports). */
    @ReactMethod
    fun deleteFile(path: String, promise: Promise) {
        try {
            val f = resolve(path)
            promise.resolve(f.delete() || !f.exists())
        } catch (e: Throwable) {
            promise.reject("DELETE", e.message, e)
        }
    }

    /** Rename/move a file within app storage (project rename). */
    @ReactMethod
    fun moveFile(from: String, to: String, promise: Promise) {
        try {
            val src = resolve(from)
            val dst = resolve(to).apply { parentFile?.mkdirs() }
            val ok = src.renameTo(dst)
            promise.resolve(ok || (src.copyTo(dst, overwrite = true).exists() && src.delete()))
        } catch (e: Throwable) {
            promise.reject("MOVE", e.message, e)
        }
    }

    /** Copy a file within app storage (duplicate project). */
    @ReactMethod
    fun copyFile(from: String, to: String, promise: Promise) {
        try {
            val src = resolve(from)
            val dst = resolve(to).apply { parentFile?.mkdirs() }
            src.copyTo(dst, overwrite = true)
            promise.resolve(dst.absolutePath)
        } catch (e: Throwable) {
            promise.reject("COPY", e.message, e)
        }
    }

    /** The real filesDir (single source of truth for project paths). */
    @ReactMethod
    fun filesDir(promise: Promise) {
        promise.resolve(reactContext.filesDir.canonicalPath)
    }
}

/**
 * SAF document picker (ACTION_OPEN_DOCUMENT). Resolves to a content:// Uri the
 * JS layer then copies into app storage via FileText.copyUriToCache. No
 * storage permission is required — this is the scoped-storage-safe path.
 */
@ReactModule(name = DocumentPickerModule.NAME)
class DocumentPickerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DocumentPicker"
        private const val REQUEST_CODE = 47131
    }

    private var pending: Promise? = null

    init {
        reactContext.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(
                activity: Activity?,
                requestCode: Int,
                resultCode: Int,
                data: Intent?,
            ) {
                if (requestCode != REQUEST_CODE) {
                    return
                }
                val promise = pending
                pending = null
                if (promise == null) {
                    return
                }
                val uri = data?.data
                if (resultCode == Activity.RESULT_OK && uri != null) {
                    try {
                        activity?.contentResolver?.takePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION,
                        )
                    } catch (_: Exception) {
                        // transient grant is enough for the immediate copy
                    }
                    promise.resolve(uri.toString())
                } else {
                    promise.resolve(null) // user cancelled — not an error
                }
            }
        })
    }

    override fun getName() = NAME

    /** Open the system picker. Resolves the picked content:// Uri or null on cancel. */
    @ReactMethod
    fun pickDocument(mimeTypes: ReadableArray, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "no foreground activity")
            return
        }
        // A previous pick that never returned must not hang its caller forever.
        pending?.resolve(null)
        pending = promise
        val types = ArrayList<String>(mimeTypes.size())
        for (i in 0 until mimeTypes.size()) {
            val v = mimeTypes.getString(i)
            if (v != null) {
                types.add(v)
            }
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (types.size == 1) types[0] else "*/*"
            if (types.isNotEmpty()) {
                putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
            }
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
            )
        }
        activity.startActivityForResult(intent, REQUEST_CODE)
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
