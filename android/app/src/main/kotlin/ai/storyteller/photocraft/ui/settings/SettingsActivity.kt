package ai.storyteller.photocraft.ui.settings

import android.app.LocaleManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.LocaleList
import android.widget.ArrayAdapter
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import kotlinx.coroutines.launch
import androidx.lifecycle.lifecycleScope
import ai.storyteller.photocraft.PhotocraftApp
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.ai.ModelStatus
import ai.storyteller.photocraft.core.NativeBridge
import ai.storyteller.photocraft.data.ExportFormat
import ai.storyteller.photocraft.data.ModelTierPreference
import ai.storyteller.photocraft.data.ThemeMode
import ai.storyteller.photocraft.databinding.ActivitySettingsBinding
import ai.storyteller.photocraft.ui.common.formatBytes
import ai.storyteller.photocraft.ui.common.snack

/**
 * Settings.
 *
 * Everything here changes real behaviour: the theme is applied through `AppCompatDelegate`, the
 * language through `LocaleManager` (API 33+) or `AppCompatDelegate`'s per-app locale, and the
 * model section reports the **real** state of the models on disk (missing / valid / corrupt) with
 * the bytes they actually use.
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySettingsBinding
    private lateinit var app: PhotocraftApp

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        app = PhotocraftApp.of(this)

        binding.toolbar.setNavigationOnClickListener { finish() }

        val settings = app.settings.current()
        when (settings.theme) {
            ThemeMode.SYSTEM -> binding.themeSystem.isChecked = true
            ThemeMode.LIGHT -> binding.themeLight.isChecked = true
            ThemeMode.DARK -> binding.themeDark.isChecked = true
        }
        binding.themeGroup.setOnCheckedChangeListener { _, checkedId ->
            app.settings.update {
                it.copy(
                    theme = when (checkedId) {
                        R.id.themeLight -> ThemeMode.LIGHT
                        R.id.themeDark -> ThemeMode.DARK
                        else -> ThemeMode.SYSTEM
                    }
                )
            }
        }

        when (settings.languageOverride) {
            null -> binding.langSystem.isChecked = true
            "en" -> binding.langEn.isChecked = true
            "ar" -> binding.langAr.isChecked = true
        }
        binding.languageGroup.setOnCheckedChangeListener { _, checkedId ->
            val tag = when (checkedId) {
                R.id.langEn -> "en"
                R.id.langAr -> "ar"
                else -> null
            }
            app.settings.update { it.copy(languageOverride = tag) }
            applyLanguage(tag)
        }

        binding.autosave.isChecked = settings.autosave
        binding.autosave.setOnCheckedChangeListener { _, checked ->
            app.settings.update { it.copy(autosave = checked) }
        }
        binding.gridSwitch.isChecked = settings.showTransparencyGrid
        binding.gridSwitch.setOnCheckedChangeListener { _, checked ->
            app.settings.update { it.copy(showTransparencyGrid = checked) }
        }
        binding.stylusSwitch.isChecked = settings.stylusPressure
        binding.stylusSwitch.setOnCheckedChangeListener { _, checked ->
            app.settings.update { it.copy(stylusPressure = checked) }
        }
        binding.reduceMotion.isChecked = settings.reduceMotion
        binding.reduceMotion.setOnCheckedChangeListener { _, checked ->
            app.settings.update { it.copy(reduceMotion = checked) }
        }

        when (settings.exportFormat) {
            ExportFormat.PNG -> binding.exportPng.isChecked = true
            ExportFormat.JPEG -> binding.exportJpeg.isChecked = true
            ExportFormat.WEBP -> binding.exportWebp.isChecked = true
        }
        binding.exportGroup.setOnCheckedChangeListener { _, checkedId ->
            app.settings.update {
                it.copy(
                    exportFormat = when (checkedId) {
                        R.id.exportJpeg -> ExportFormat.JPEG
                        R.id.exportWebp -> ExportFormat.WEBP
                        else -> ExportFormat.PNG
                    }
                )
            }
        }

        binding.modelTier.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            listOf(
                getString(R.string.settings_model_tier_auto),
                getString(R.string.ai_quick_remove),
                getString(R.string.ai_high_quality),
                getString(R.string.export_png)
            )
        )
        binding.modelTier.setSelection(settings.modelTier.ordinal)
        binding.meteredSwitch.isChecked = settings.downloadOnMeteredNetwork
        binding.meteredSwitch.setOnCheckedChangeListener { _, checked ->
            app.settings.update { it.copy(downloadOnMeteredNetwork = checked) }
        }

        binding.version.text = getString(
            R.string.settings_version,
            runCatching { packageManager.getPackageInfo(packageName, 0).versionName ?: "0.5.0" }
                .getOrDefault("0.5.0")
        )
        binding.engineVersion.text = getString(
            R.string.settings_engine,
            runCatching { NativeBridge.nativeVersion() }.getOrDefault("unknown")
        )

        refreshModels()
    }

    /** Reads the models directory: the numbers shown are the files actually on disk. */
    private fun refreshModels() {
        val specs = app.models.specs
        val ready = specs.count { app.models.status(it) == ModelStatus.VALID }
        val used = app.models.usedBytes()
        binding.modelsSummary.text = getString(
            R.string.settings_models_summary,
            "$ready/${specs.size}",
            formatBytes(used)
        )
    }

    /**
     * Applies the language.
     *
     * On Android 13+ the per-app locale is set through `LocaleManager`; below that, through
     * `AppCompatDelegate`. Either way the user is told the app restarts, because a running
     * activity cannot re-inflate its resources in place.
     */
    private fun applyLanguage(tag: String?) {
        val locales = LocaleList.forLanguageTags(tag ?: LocaleList.getDefault().toLanguageTags())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getSystemService(LocaleManager::class.java).applicationLocales = locales
        } else {
            AppCompatDelegate.setApplicationLocales(
                androidx.core.os.LocaleListCompat.forLanguageTags(tag ?: "")
            )
        }
        binding.root.snack(getString(R.string.settings_restart_needed), long = true)
        lifecycleScope.launch {
            kotlinx.coroutines.delay(600)
            val intent = Intent(this@SettingsActivity, SettingsActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
            finishAffinity()
        }
    }
}
