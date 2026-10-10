package ai.storyteller.photocraft.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * An asset the user imported into PhotoCraft: a photo, a logo, a texture, a sticker.
 *
 * Assets are real files in the app's private storage, indexed in JSON, and thumbnailed so the
 * library grid stays fast. Placing one into a document copies its bytes into the engine
 * (`file.placeEmbedded`), so the document never depends on a Uri it may lose access to.
 */
data class Asset(
    val id: String,
    val name: String,
    val path: String,
    val mime: String,
    val width: Int,
    val height: Int,
    val bytes: Long,
    val addedAt: Long,
    val thumbnailPath: String? = null,
    val tags: List<String> = emptyList()
) {
    fun matches(query: String): Boolean =
        query.isBlank() || name.contains(query, ignoreCase = true) || tags.any { it.contains(query, ignoreCase = true) }

    /** Rough shape, for the grid's aspect-ratio-aware placeholders. */
    val aspect: Float get() = if (height == 0) 1f else width.toFloat() / height.toFloat()
}

class AssetRepository(private val context: Context) {

    private val indexFile: File get() = File(context.filesDir, "assets/index.json")

    private val filesDir: File get() = File(context.filesDir, "assets/files").apply { mkdirs() }

    private val thumbsDir: File get() = File(context.filesDir, "assets/thumbs").apply { mkdirs() }

    suspend fun all(query: String = ""): List<Asset> = withContext(Dispatchers.IO) {
        read().filter { it.matches(query) }.sortedByDescending { it.addedAt }
    }

    suspend fun get(id: String): Asset? = withContext(Dispatchers.IO) { read().firstOrNull { it.id == id } }

    /** Reads the bytes of an asset (for placing it into a document or for export). */
    suspend fun bytes(id: String): ByteArray? = withContext(Dispatchers.IO) {
        val asset = read().firstOrNull { it.id == id } ?: return@withContext null
        runCatching { File(asset.path).readBytes() }.getOrNull()
    }

    /**
     * Imports an image: decodes it once for the real size, stores the original bytes, writes a
     * thumbnail and adds the index entry. Returns the stored asset, or `null` if the bytes are not
     * a decodable image.
     */
    suspend fun import(name: String, data: ByteArray, mime: String = "image/*"): Asset? = withContext(Dispatchers.IO) {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@withContext null

        val id = UUID.randomUUID().toString()
        val target = File(filesDir, "$id-${name.replace(Regex("[^A-Za-z0-9._-]"), "_")}")
        target.writeBytes(data)

        val thumb = File(thumbsDir, "$id.png")
        runCatching {
            val opts = BitmapFactory.Options().apply { inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, 256) }
            BitmapFactory.decodeByteArray(data, 0, data.size, opts)?.let { bmp ->
                thumb.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 85, it) }
                bmp.recycle()
            }
        }

        val asset = Asset(
            id = id,
            name = name.substringBeforeLast('.').ifBlank { name },
            path = target.absolutePath,
            mime = mime,
            width = bounds.outWidth,
            height = bounds.outHeight,
            bytes = target.length(),
            addedAt = System.currentTimeMillis(),
            thumbnailPath = if (thumb.isFile) thumb.absolutePath else null,
            tags = listOf(name.substringAfterLast('.', "").lowercase()).filter { it.isNotBlank() }
        )
        write(read() + asset)
        asset
    }

    suspend fun rename(id: String, name: String) = withContext(Dispatchers.IO) {
        write(read().map { if (it.id == id) it.copy(name = name) else it })
    }

    suspend fun delete(id: String) = withContext(Dispatchers.IO) {
        val asset = read().firstOrNull { it.id == id }
        write(read().filterNot { it.id == id })
        asset?.path?.let { File(it).delete() }
        asset?.thumbnailPath?.let { File(it).delete() }
    }

    /** Drops entries whose file disappeared. */
    suspend fun prune() = withContext(Dispatchers.IO) {
        val kept = read().filter { File(it.path).isFile }
        write(kept)
        kept.size
    }

    private fun sampleSizeFor(w: Int, h: Int, target: Int): Int {
        var size = 1
        while (maxOf(w, h) / size > target) size *= 2
        return size
    }

    private fun read(): List<Asset> {
        if (!indexFile.isFile) return emptyList()
        return runCatching {
            val json = JSONArray(indexFile.readText())
            val out = mutableListOf<Asset>()
            for (i in 0 until json.length()) {
                val o = json.optJSONObject(i) ?: continue
                out += Asset(
                    id = o.optString("id"),
                    name = o.optString("name"),
                    path = o.optString("path"),
                    mime = o.optString("mime", "image/*"),
                    width = o.optInt("width", 0),
                    height = o.optInt("height", 0),
                    bytes = o.optLong("bytes", 0L),
                    addedAt = o.optLong("addedAt", 0L),
                    thumbnailPath = o.optString("thumbnailPath", "").ifBlank { null },
                    tags = o.optJSONArray("tags")?.let { arr -> (0 until arr.length()).map { arr.optString(it) } }.orEmpty()
                )
            }
            out
        }.getOrDefault(emptyList())
    }

    private fun write(list: List<Asset>) {
        filesDir.mkdirs()
        val json = JSONArray()
        list.forEach { a ->
            json.put(JSONObject().apply {
                put("id", a.id)
                put("name", a.name)
                put("path", a.path)
                put("mime", a.mime)
                put("width", a.width)
                put("height", a.height)
                put("bytes", a.bytes)
                put("addedAt", a.addedAt)
                put("thumbnailPath", a.thumbnailPath ?: "")
                put("tags", JSONArray().apply { a.tags.forEach { put(it) } })
            })
        }
        val temp = File(indexFile.parentFile, "index.json.tmp")
        temp.writeText(json.toString())
        if (!temp.renameTo(indexFile)) {
            indexFile.delete()
            temp.renameTo(indexFile)
        }
    }
}
