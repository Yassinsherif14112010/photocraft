package ai.storyteller.photocraft.core

import org.json.JSONObject

/** One row of the layers panel, straight from the engine's document. */
data class LayerInfo(
    val id: Long,
    val name: String,
    val visible: Boolean,
    val opacity: Float,
    val blend: String,
    val kind: String,
    val hasMask: Boolean,
    val maskEnabled: Boolean,
    val clipped: Boolean,
    val locked: Boolean,
    val depth: Int
)

/** The engine's view of the open document. Rebuilt after every edit; never hand-maintained. */
data class DocumentInfo(
    val name: String,
    val width: Int,
    val height: Int,
    val mode: String,
    val depth: Int,
    val resolution: Float,
    val revision: Long,
    val dirty: Boolean,
    val canUndo: Boolean,
    val canRedo: Boolean,
    val activeLayer: Long?,
    val selectedLayers: List<Long>,
    val path: String?,
    val readOnlySource: Boolean,
    val layers: List<LayerInfo>
) {
    /** Megapixels, for the editor's status line. */
    val megapixels: Float get() = width.toFloat() * height.toFloat() / 1_000_000f

    val aspect: Float get() = if (height == 0) 1f else width.toFloat() / height.toFloat()

    fun layer(id: Long?): LayerInfo? = layers.firstOrNull { it.id == id }

    companion object {
        fun parse(json: JSONObject): DocumentInfo {
            val layers = json.optJSONArray("layers")
            val list = mutableListOf<LayerInfo>()
            if (layers != null) {
                for (i in 0 until layers.length()) {
                    val l = layers.optJSONObject(i) ?: continue
                    list += LayerInfo(
                        id = l.optLong("id"),
                        name = l.optString("name", ""),
                        visible = l.optBoolean("visible", true),
                        opacity = l.optDouble("opacity", 1.0).toFloat(),
                        blend = l.optString("blend", "Normal"),
                        kind = l.optString("kind", ""),
                        hasMask = l.optBoolean("hasMask", false),
                        maskEnabled = l.optBoolean("maskEnabled", false),
                        clipped = l.optBoolean("clipped", false),
                        locked = l.optBoolean("locked", false),
                        depth = l.optInt("depth", 0)
                    )
                }
            }
            val selected = json.optJSONArray("selectedLayers")
            val selectedIds = mutableListOf<Long>()
            if (selected != null) {
                for (i in 0 until selected.length()) selectedIds += selected.optLong(i)
            }
            return DocumentInfo(
                name = json.optString("name", ""),
                width = json.optInt("width", 0),
                height = json.optInt("height", 0),
                mode = json.optString("mode", "rgb"),
                depth = json.optInt("depth", 8),
                resolution = json.optDouble("resolution", 72.0).toFloat(),
                revision = json.optLong("revision", 0L),
                dirty = json.optBoolean("dirty", false),
                canUndo = json.optBoolean("canUndo", false),
                canRedo = json.optBoolean("canRedo", false),
                activeLayer = if (json.isNull("activeLayer")) null else json.optLong("activeLayer"),
                selectedLayers = selectedIds,
                path = json.optString("path", "").ifBlank { null },
                readOnlySource = json.optBoolean("readOnlySource", false),
                layers = list
            )
        }
    }
}
