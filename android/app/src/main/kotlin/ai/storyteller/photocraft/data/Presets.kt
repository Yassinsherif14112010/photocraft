package ai.storyteller.photocraft.data

import android.os.Parcelable
import kotlinx.parcelize.Parcelize

/**
 * A document size preset. The social-media sizes are the platforms' current recommended pixel
 * sizes; "Custom" opens the size fields for editing.
 */
@Parcelize
data class DocumentPreset(
    val id: String,
    val nameRes: String,
    val width: Int,
    val height: Int,
    val group: Group,
    val background: Background = Background.WHITE,
    val resolution: Int = 72
) : Parcelable {

    enum class Group { SOCIAL, PRINT, BLANK }

    /** What the new document's single starting layer is filled with. */
    enum class Background { WHITE, BLACK, TRANSPARENT }

    val aspect: Float get() = width.toFloat() / height.toFloat()

    val isPortrait: Boolean get() = height > width

    fun label(formatted: (String) -> String): String = formatted(nameRes)

    companion object {

        /** Every preset the New-project and Templates screens offer. */
        val ALL: List<DocumentPreset> = listOf(
            // Social
            DocumentPreset("ig_post", "preset_ig_post", 1080, 1080, Group.SOCIAL),
            DocumentPreset("ig_portrait", "preset_ig_portrait", 1080, 1350, Group.SOCIAL),
            DocumentPreset("ig_story", "preset_ig_story", 1080, 1920, Group.SOCIAL),
            DocumentPreset("ig_reel", "preset_ig_reel", 1080, 1920, Group.SOCIAL),
            DocumentPreset("fb_post", "preset_fb_post", 1200, 630, Group.SOCIAL),
            DocumentPreset("fb_story", "preset_fb_story", 1080, 1920, Group.SOCIAL),
            DocumentPreset("fb_cover", "preset_fb_cover", 1640, 624, Group.SOCIAL),
            DocumentPreset("yt_thumbnail", "preset_yt_thumbnail", 1280, 720, Group.SOCIAL),
            DocumentPreset("yt_channel", "preset_yt_channel", 2560, 1440, Group.SOCIAL),
            DocumentPreset("yt_short", "preset_yt_short", 1080, 1920, Group.SOCIAL),
            DocumentPreset("tiktok", "preset_tiktok", 1080, 1920, Group.SOCIAL),
            DocumentPreset("x_post", "preset_x_post", 1600, 900, Group.SOCIAL),
            DocumentPreset("linkedin", "preset_linkedin", 1200, 627, Group.SOCIAL),
            DocumentPreset("pinterest", "preset_pinterest", 1000, 1500, Group.SOCIAL),
            // Print
            DocumentPreset("a4_300", "preset_a4_300", 2480, 3508, Group.PRINT, resolution = 300),
            DocumentPreset("a5_300", "preset_a5_300", 1748, 2480, Group.PRINT, resolution = 300),
            DocumentPreset("letter_300", "preset_letter_300", 2550, 3300, Group.PRINT, resolution = 300),
            DocumentPreset("photo_4x6", "preset_photo_4x6", 1800, 1200, Group.PRINT, resolution = 300),
            // Blank canvases
            DocumentPreset("blank_hd", "preset_blank_hd", 1920, 1080, Group.BLANK),
            DocumentPreset("blank_square", "preset_blank_square", 2048, 2048, Group.BLANK),
            DocumentPreset("blank_transparent", "preset_blank_transparent", 1080, 1080, Group.BLANK, Background.TRANSPARENT)
        )

        fun byId(id: String): DocumentPreset? = ALL.firstOrNull { it.id == id }

        /** Used by the search field on the home screen and the templates screen. */
        fun search(query: String): List<DocumentPreset> {
            val q = query.trim()
            if (q.isEmpty()) return ALL
            return ALL.filter { it.id.contains(q, ignoreCase = true) || it.group.name.contains(q, ignoreCase = true) }
        }
    }
}
