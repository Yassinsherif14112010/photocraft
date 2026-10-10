package ai.storyteller.photocraft.data

import android.content.Context
import android.graphics.Bitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.UUID

/**
 * A saved project: the `.pcraft` file the engine wrote, plus what the home screen needs to show
 * a card (thumbnail, size, last edit).
 *
 * The document itself always lives in the engine's native layered format, so reopening restores
 * every layer, mask and effect — this is never a flattened preview.
 */
data class Project(
    val id: String,
    val name: String,
    /** Absolute path of the `.pcraft` file in the app's private storage. */
    val path: String,
    val width: Int,
    val height: Int,
    val updatedAt: Long,
    val thumbnailPath: String?,
    val presetId: String? = null,
    /** True while the project has never been opened (used by the "Continue editing" row). */
    val openedOnce: Boolean = false
) {
    /** Path-safe file name for the document. */
    val fileName: String get() = "$id.pcraft"

    val megapixels: Float get() = width.toFloat() * height.toFloat() / 1_000_000f

    fun matches(query: String): Boolean =
        query.isBlank() || name.contains(query, ignoreCase = true)
}

/**
 * The recent-projects index (JSON) and the documents directory.
 *
 * Writes are atomic (temp file + rename), so an interrupted autosave cannot corrupt the index and
 * lose the list of the user's projects.
 */
class ProjectStore(private val context: Context) {

    private val indexFile: File get() = File(context.filesDir, "projects/index.json")

    val documentsDir: File get() = File(context.filesDir, "projects").apply { mkdirs() }

    private val thumbsDir: File get() = File(context.filesDir, "thumbs").apply { mkdirs() }

    suspend fun all(): List<Project> = withContext(Dispatchers.IO) { read() }

    /** Most recently edited first, filtered by the home screen's search field. */
    suspend fun recent(query: String = "", limit: Int = 50): List<Project> = withContext(Dispatchers.IO) {
        val list = read().filter { it.matches(query) }.sortedByDescending { it.updatedAt }
        if (limit <= 0) list else list.take(limit)
    }

    suspend fun get(id: String): Project? = withContext(Dispatchers.IO) { read().firstOrNull { it.id == id } }

    suspend fun upsert(project: Project) = withContext(Dispatchers.IO) {
        val list = read().filter { it.id != project.id }.toMutableList()
        list.add(project)
        write(list)
        project
    }

    /** Saves (or replaces) a project's thumbnail at a size the home screen grid needs. */
    suspend fun saveThumbnail(id: String, bitmap: Bitmap): String? = withContext(Dispatchers.IO) {
        val file = File(thumbsDir, "$id.png")
        runCatching {
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 90, it) }
            file.absolutePath
        }.getOrNull()
    }

    suspend fun touch(id: String, width: Int, height: Int) = withContext(Dispatchers.IO) {
        val list = read().toMutableList()
        val index = list.indexOfFirst { it.id == id }
        if (index >= 0) {
            list[index] = list[index].copy(updatedAt = System.currentTimeMillis(), width = width, height = height, openedOnce = true)
            write(list)
        }
    }

    suspend fun rename(id: String, name: String) = withContext(Dispatchers.IO) {
        val list = read().toMutableList()
        val index = list.indexOfFirst { it.id == id }
        if (index >= 0) {
            list[index] = list[index].copy(name = name, updatedAt = System.currentTimeMillis())
            write(list)
        }
    }

    /** Deletes the index entry, the document and its thumbnail. */
    suspend fun delete(id: String) = withContext(Dispatchers.IO) {
        val list = read().filter { it.id != id }
        write(list)
        File(documentsDir, "$id.pcraft").delete()
        File(thumbsDir, "$id.png").delete()
    }

    /** Drops index entries whose document no longer exists (a cleared cache, a restore). */
    suspend fun pruneMissing() = withContext(Dispatchers.IO) {
        val list = read().filter { File(it.path).isFile }
        write(list)
        list.size
    }

    fun newId(): String = UUID.randomUUID().toString().lowercase(Locale.US)

    fun documentFile(id: String): File = File(documentsDir, "$id.pcraft")

    // ---- persistence --------------------------------------------------------

    private fun read(): List<Project> {
        val file = indexFile
        if (!file.isFile) return emptyList()
        return runCatching {
            val json = JSONArray(file.readText())
            val out = mutableListOf<Project>()
            for (i in 0 until json.length()) {
                val o = json.optJSONObject(i) ?: continue
                out += Project(
                    id = o.optString("id"),
                    name = o.optString("name", "Untitled"),
                    path = o.optString("path"),
                    width = o.optInt("width", 0),
                    height = o.optInt("height", 0),
                    updatedAt = o.optLong("updatedAt", 0L),
                    thumbnailPath = o.optString("thumbnailPath", "").ifBlank { null },
                    presetId = o.optString("presetId", "").ifBlank { null },
                    openedOnce = o.optBoolean("openedOnce", false)
                )
            }
            out
        }.getOrDefault(emptyList())
    }

    private fun write(list: List<Project>) {
        documentsDir.mkdirs()
        val json = JSONArray()
        for (p in list) {
            json.put(JSONObject().apply {
                put("id", p.id)
                put("name", p.name)
                put("path", p.path)
                put("width", p.width)
                put("height", p.height)
                put("updatedAt", p.updatedAt)
                put("thumbnailPath", p.thumbnailPath ?: "")
                put("presetId", p.presetId ?: "")
                put("openedOnce", p.openedOnce)
            })
        }
        val temp = File(indexFile.parentFile, "index.json.tmp")
        temp.writeText(json.toString())
        if (!temp.renameTo(indexFile)) {
            // Some file systems refuse the rename over an existing file.
            indexFile.delete()
            temp.renameTo(indexFile)
        }
    }
}
