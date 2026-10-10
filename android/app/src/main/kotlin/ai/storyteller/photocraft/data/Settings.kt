package ai.storyteller.photocraft.data

import android.content.Context
import android.content.SharedPreferences
import androidx.appcompat.app.AppCompatDelegate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ThemeMode { SYSTEM, LIGHT, DARK }

/** The flat-export formats the engine can actually write (`photocraft-io`). */
enum class ExportFormat(val extension: String, val supportsAlpha: Boolean) {
    PNG("png", true),
    JPEG("jpg", false),
    WEBP("webp", true);

    companion object {
        fun fromExtension(ext: String): ExportFormat =
            entries.firstOrNull { it.extension.equals(ext, ignoreCase = true) } ?: PNG
    }
}

/** How the app picks a background-removal model when the user does not choose one. */
enum class ModelTierPreference { AUTO, QUICK, BALANCED, HQ }

/** Everything the user can change in Settings. */
data class Settings(
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val exportFormat: ExportFormat = ExportFormat.PNG,
    val exportScalePercent: Int = 100,
    val jpegQuality: Int = 90,
    val webpQuality: Int = 85,
    val webpLossless: Boolean = false,
    val preserveTransparency: Boolean = true,
    val autosave: Boolean = true,
    val autosaveSeconds: Int = 20,
    val modelTier: ModelTierPreference = ModelTierPreference.AUTO,
    val downloadOnMeteredNetwork: Boolean = false,
    val showTransparencyGrid: Boolean = true,
    val stylusPressure: Boolean = true,
    val reduceMotion: Boolean = false,
    /** Forces a UI language ("ar" for Arabic, "en", or `null` for the system default). */
    val languageOverride: String? = null
) {
    val exportOptionsJson: String
        get() = buildString {
            append("{\"jpegQuality\":").append(jpegQuality)
            append(",\"webpQuality\":").append(webpQuality)
            append(",\"webpLossless\":").append(webpLossless)
            append("}")
        }
}

/**
 * Settings in SharedPreferences, exposed as a [StateFlow] so every screen updates live.
 *
 * The theme is applied through `AppCompatDelegate` (light / dark / follow the system), and the
 * language override re-creates the activities that are already running.
 */
class SettingsRepository(context: Context) {

    private val appContext = context.applicationContext

    private val prefs: SharedPreferences =
        appContext.getSharedPreferences("photocraft_settings", Context.MODE_PRIVATE)

    private val _settings = MutableStateFlow(read())
    val settings: StateFlow<Settings> = _settings.asStateFlow()

    private val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
        val next = read()
        _settings.value = next
        applyTheme(next.theme)
    }

    init {
        prefs.registerOnSharedPreferenceChangeListener(listener)
        applyTheme(settings.value.theme)
    }

    fun current(): Settings = settings.value

    fun update(patch: (Settings) -> Settings) {
        val next = patch(settings.value)
        prefs.edit().apply {
            putString(KEY_THEME, next.theme.name)
            putString(KEY_EXPORT_FORMAT, next.exportFormat.name)
            putInt(KEY_EXPORT_SCALE, next.exportScalePercent)
            putInt(KEY_JPEG_QUALITY, next.jpegQuality)
            putInt(KEY_WEBP_QUALITY, next.webpQuality)
            putBoolean(KEY_WEBP_LOSSLESS, next.webpLossless)
            putBoolean(KEY_PRESERVE_TRANSPARENCY, next.preserveTransparency)
            putBoolean(KEY_AUTOSAVE, next.autosave)
            putInt(KEY_AUTOSAVE_SECONDS, next.autosaveSeconds)
            putString(KEY_MODEL_TIER, next.modelTier.name)
            putBoolean(KEY_METERED, next.downloadOnMeteredNetwork)
            putBoolean(KEY_GRID, next.showTransparencyGrid)
            putBoolean(KEY_STYLUS, next.stylusPressure)
            putBoolean(KEY_REDUCE_MOTION, next.reduceMotion)
            putString(KEY_LANGUAGE, next.languageOverride ?: "")
            apply()
        }
        _settings.value = next
        applyTheme(next.theme)
    }

    private fun read(): Settings = Settings(
        theme = prefs.getString(KEY_THEME, null)?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() } ?: ThemeMode.SYSTEM,
        exportFormat = prefs.getString(KEY_EXPORT_FORMAT, null)
            ?.let { runCatching { ExportFormat.valueOf(it) }.getOrNull() } ?: ExportFormat.PNG,
        exportScalePercent = prefs.getInt(KEY_EXPORT_SCALE, 100).coerceIn(10, 400),
        jpegQuality = prefs.getInt(KEY_JPEG_QUALITY, 90).coerceIn(1, 100),
        webpQuality = prefs.getInt(KEY_WEBP_QUALITY, 85).coerceIn(1, 100),
        webpLossless = prefs.getBoolean(KEY_WEBP_LOSSLESS, false),
        preserveTransparency = prefs.getBoolean(KEY_PRESERVE_TRANSPARENCY, true),
        autosave = prefs.getBoolean(KEY_AUTOSAVE, true),
        autosaveSeconds = prefs.getInt(KEY_AUTOSAVE_SECONDS, 20).coerceIn(5, 300),
        modelTier = prefs.getString(KEY_MODEL_TIER, null)
            ?.let { runCatching { ModelTierPreference.valueOf(it) }.getOrNull() } ?: ModelTierPreference.AUTO,
        downloadOnMeteredNetwork = prefs.getBoolean(KEY_METERED, false),
        showTransparencyGrid = prefs.getBoolean(KEY_GRID, true),
        stylusPressure = prefs.getBoolean(KEY_STYLUS, true),
        reduceMotion = prefs.getBoolean(KEY_REDUCE_MOTION, false),
        languageOverride = prefs.getString(KEY_LANGUAGE, "")?.ifBlank { null }
    )

    private fun applyTheme(mode: ThemeMode) {
        val night = when (mode) {
            ThemeMode.SYSTEM -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
            ThemeMode.LIGHT -> AppCompatDelegate.MODE_NIGHT_NO
            ThemeMode.DARK -> AppCompatDelegate.MODE_NIGHT_YES
        }
        if (AppCompatDelegate.getDefaultNightMode() != night) {
            AppCompatDelegate.setDefaultNightMode(night)
        }
    }

    companion object {
        private const val KEY_THEME = "theme"
        private const val KEY_EXPORT_FORMAT = "export_format"
        private const val KEY_EXPORT_SCALE = "export_scale"
        private const val KEY_JPEG_QUALITY = "jpeg_quality"
        private const val KEY_WEBP_QUALITY = "webp_quality"
        private const val KEY_WEBP_LOSSLESS = "webp_lossless"
        private const val KEY_PRESERVE_TRANSPARENCY = "preserve_transparency"
        private const val KEY_AUTOSAVE = "autosave"
        private const val KEY_AUTOSAVE_SECONDS = "autosave_seconds"
        private const val KEY_MODEL_TIER = "model_tier"
        private const val KEY_METERED = "metered_download"
        private const val KEY_GRID = "transparency_grid"
        private const val KEY_STYLUS = "stylus_pressure"
        private const val KEY_REDUCE_MOTION = "reduce_motion"
        private const val KEY_LANGUAGE = "language_override"
    }
}
