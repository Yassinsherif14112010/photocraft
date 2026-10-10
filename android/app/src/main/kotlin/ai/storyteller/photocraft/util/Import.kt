package ai.storyteller.photocraft.util

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import java.util.Locale

/** A picked or shared file, read into memory so the engine can import it. */
data class PickedFile(
    val uri: Uri,
    val name: String,
    val mime: String,
    val bytes: ByteArray,
    /** Size of the file as reported by the provider (0 when unknown). */
    val size: Long
)

/** The extensions PhotoCraft can open, paired with the MIME types used in pickers and intents. */
val IMPORTABLE_MIME_TYPES: Array<String> = arrayOf(
    "image/*",
    "application/octet-stream",
    "application/photoshop",
    "image/vnd.adobe.photoshop"
)

private val IMPORTABLE_EXTENSIONS = setOf(
    "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "ico", "qoi",
    "psd", "psb", "pcraft", "heic", "heif", "avif", "exr", "hdr", "ppm", "pgm", "pbm", "pam", "pfm"
)

/**
 * Reads a content URI into memory.
 *
 * Handles the whole surface of Android sharing: `content://` from the photo picker, a chat
 * attachment, a `file://` leftover and a `SEND` stream. Anything that cannot be read returns
 * `null` with a reason the UI shows; nothing here throws.
 */
fun Context.readPickedFile(uri: Uri, sizeLimitBytes: Long = 512L * 1024 * 1024): Pair<PickedFile?, String?> {
    val resolver: ContentResolver = contentResolver
    val name = displayName(resolver, uri)
    val mime = resolver.getType(uri).orEmpty()
    val size = runCatching {
        resolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: -1L
    }.getOrDefault(-1L)
    if (size > sizeLimitBytes) {
        return null to getString(R.string.import_failed, name, "the file is larger than ${sizeLimitBytes / 1_000_000} MB")
    }
    return runCatching {
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() }
        if (bytes == null || bytes.isEmpty()) {
            null to getString(R.string.import_unsupported)
        } else {
            PickedFile(uri, name, mime, bytes, size) to null
        }
    }.getOrElse { e ->
        null to getString(R.string.import_failed, name, e.message ?: "read failed")
    }
}

/** A display name for the URI, falling back to the extension the MIME type implies. */
fun Context.displayName(resolver: ContentResolver, uri: Uri): String {
    resolver.query(uri, null, null, null, null)?.use { cursor ->
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0 && cursor.moveToFirst()) {
            val name = cursor.getString(index)
            if (!name.isNullOrBlank()) return name
        }
    }
    val last = uri.lastPathSegment.orEmpty().substringAfterLast('/')
    if (last.isNotBlank()) return last
    val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(resolver.getType(uri))
    return "import.${ext ?: "png"}"
}

/** True when the name or MIME type is something the engine's importer can plausibly read. */
fun looksImportable(name: String, mime: String): Boolean {
    val ext = name.substringAfterLast('.', "").lowercase(Locale.US)
    if (ext in IMPORTABLE_EXTENSIONS) return true
    if (mime.startsWith("image/")) return true
    return mime in setOf("application/octet-stream", "application/photoshop", "image/vnd.adobe.photoshop")
}

/** A safe file name for a copy inside the app's private storage. */
fun safeFileName(name: String): String =
    name.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "import.png" }

/**
 * Writes bytes into the app's private files directory and returns the absolute path, which the
 * engine's file-based commands (`file.open`, `file.placeEmbedded`) can read on Android.
 */
fun Context.writeToPrivateFile(bytes: ByteArray, name: String, directory: String = "imports"): String {
    val dir = java.io.File(filesDir, directory).apply { mkdirs() }
    val file = java.io.File(dir, safeFileName(name))
    file.writeBytes(bytes)
    return file.absolutePath
}
