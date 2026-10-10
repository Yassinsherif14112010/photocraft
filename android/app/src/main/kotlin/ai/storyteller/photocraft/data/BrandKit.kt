package ai.storyteller.photocraft.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** A brand colour: the swatch name plus its sRGB hex (e.g. `#1A73E8`). */
data class BrandColor(val name: String, val hex: String) {
    /** Human-readable name, or the hex when the user never named it. */
    val displayName: String get() = name.ifBlank { hex }
}

/** A font the user marked as theirs. Resolved through the system font list at use time. */
data class BrandFont(val family: String, val weight: Int = 400, val italic: Boolean = false)

/** A stored logo / mark, kept as a real file in the app's private storage. */
data class BrandLogo(val name: String, val path: String, val addedAt: Long)

/** A reusable text style (Text Studio presets and the Brand Kit). */
data class TextStylePreset(
    val id: String,
    val name: String,
    val fontFamily: String,
    val sizePt: Float,
    val letterSpacing: Float,
    val lineHeight: Float,
    val hex: String,
    val align: Align,
    val bold: Boolean
) {
    enum class Align { START, CENTER, END, JUSTIFY }
}

/**
 * The persistent Brand Kit: colours, fonts, logos and text styles that follow every project.
 *
 * Stored as one JSON file in the app's private storage, written atomically.
 */
class BrandKitRepository(private val context: Context) {

    private val file: File get() = File(context.filesDir, "brandkit.json")

    private val logosDir: File get() = File(context.filesDir, "brandkit/logos").apply { mkdirs() }

    suspend fun load(): BrandKit = withContext(Dispatchers.IO) {
        if (!file.isFile) return@withContext BrandKit()
        runCatching {
            val o = JSONObject(file.readText())
            BrandKit(
                colors = o.optJSONArray("colors").toList { BrandColor(it.optString("name"), it.optString("hex")) },
                fonts = o.optJSONArray("fonts").toList {
                    BrandFont(it.optString("family"), it.optInt("weight", 400), it.optBoolean("italic", false))
                },
                logos = o.optJSONArray("logos").toList {
                    BrandLogo(it.optString("name"), it.optString("path"), it.optLong("addedAt", 0L))
                },
                textStyles = o.optJSONArray("textStyles").toList {
                    TextStylePreset(
                        id = it.optString("id"),
                        name = it.optString("name"),
                        fontFamily = it.optString("fontFamily", "sans-serif"),
                        sizePt = it.optDouble("sizePt", 24.0).toFloat(),
                        letterSpacing = it.optDouble("letterSpacing", 0.0).toFloat(),
                        lineHeight = it.optDouble("lineHeight", 1.2).toFloat(),
                        hex = it.optString("hex", "#FFFFFF"),
                        align = runCatching { TextStylePreset.Align.valueOf(it.optString("align", "START")) }
                            .getOrDefault(TextStylePreset.Align.START),
                        bold = it.optBoolean("bold", false)
                    )
                }
            )
        }.getOrDefault(BrandKit())
    }

    suspend fun save(kit: BrandKit) = withContext(Dispatchers.IO) {
        val o = JSONObject().apply {
            put("colors", JSONArray().apply { kit.colors.forEach { c -> put(JSONObject().put("name", c.name).put("hex", c.hex)) } })
            put("fonts", JSONArray().apply {
                kit.fonts.forEach { f ->
                    put(JSONObject().put("family", f.family).put("weight", f.weight).put("italic", f.italic))
                }
            })
            put("logos", JSONArray().apply {
                kit.logos.forEach { l -> put(JSONObject().put("name", l.name).put("path", l.path).put("addedAt", l.addedAt)) }
            })
            put("textStyles", JSONArray().apply {
                kit.textStyles.forEach { s ->
                    put(JSONObject().apply {
                        put("id", s.id)
                        put("name", s.name)
                        put("fontFamily", s.fontFamily)
                        put("sizePt", s.sizePt.toDouble())
                        put("letterSpacing", s.letterSpacing.toDouble())
                        put("lineHeight", s.lineHeight.toDouble())
                        put("hex", s.hex)
                        put("align", s.align.name)
                        put("bold", s.bold)
                    })
                }
            })
        }
        atomicWrite(file, o.toString())
    }

    suspend fun addColor(color: BrandColor) = withContext(Dispatchers.IO) {
        val kit = load()
        if (kit.colors.none { it.hex.equals(color.hex, ignoreCase = true) }) {
            save(kit.copy(colors = kit.colors + color))
        }
    }

    suspend fun removeColor(hex: String) = withContext(Dispatchers.IO) {
        val kit = load()
        save(kit.copy(colors = kit.colors.filterNot { it.hex.equals(hex, ignoreCase = true) }))
    }

    suspend fun addFont(font: BrandFont) = withContext(Dispatchers.IO) {
        val kit = load()
        if (kit.fonts.none { it.family == font.family && it.weight == font.weight && it.italic == font.italic }) {
            save(kit.copy(fonts = kit.fonts + font))
        }
    }

    /** Copies an imported image into the brand-kit logo folder and records it. */
    suspend fun addLogo(name: String, bytes: ByteArray) = withContext(Dispatchers.IO) {
        val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val target = File(logosDir, "${System.currentTimeMillis()}_$safe")
        target.writeBytes(bytes)
        val kit = load()
        val logo = BrandLogo(name, target.absolutePath, System.currentTimeMillis())
        save(kit.copy(logos = kit.logos + logo))
        logo
    }

    suspend fun removeLogo(path: String) = withContext(Dispatchers.IO) {
        File(path).delete()
        val kit = load()
        save(kit.copy(logos = kit.logos.filterNot { it.path == path }))
    }

    suspend fun saveTextStyle(style: TextStylePreset) = withContext(Dispatchers.IO) {
        val kit = load()
        save(kit.copy(textStyles = kit.textStyles.filterNot { it.id == style.id } + style))
    }

    suspend fun removeTextStyle(id: String) = withContext(Dispatchers.IO) {
        val kit = load()
        save(kit.copy(textStyles = kit.textStyles.filterNot { it.id == id }))
    }

    private fun atomicWrite(file: File, text: String) {
        file.parentFile?.mkdirs()
        val temp = File(file.parentFile, "${file.name}.tmp")
        temp.writeText(text)
        if (!temp.renameTo(file)) {
            file.delete()
            temp.renameTo(file)
        }
    }

    private inline fun <T> JSONArray?.toList(map: (JSONObject) -> T): List<T> {
        if (this == null) return emptyList()
        val out = mutableListOf<T>()
        for (i in 0 until length()) {
            val o = optJSONObject(i) ?: continue
            runCatching { out += map(o) }
        }
        return out
    }
}

data class BrandKit(
    val colors: List<BrandColor> = emptyList(),
    val fonts: List<BrandFont> = emptyList(),
    val logos: List<BrandLogo> = emptyList(),
    val textStyles: List<TextStylePreset> = emptyList()
)
