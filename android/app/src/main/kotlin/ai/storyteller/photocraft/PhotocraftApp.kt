package ai.storyteller.photocraft

import android.app.Application
import ai.storyteller.photocraft.ai.ModelManager
import ai.storyteller.photocraft.core.NativeBridge
import ai.storyteller.photocraft.data.AssetRepository
import ai.storyteller.photocraft.data.BrandKitRepository
import ai.storyteller.photocraft.data.ProjectStore
import ai.storyteller.photocraft.data.SettingsRepository

/**
 * Application entry point.
 *
 * Loads `libphotocraft.so` — the Rust engine built from `android/jni-rust` — and holds the
 * repositories every screen shares. Loading happens here, not in an activity, so a background
 * restore (the OS re-creating an activity after a configuration change) never hits an unloaded
 * library.
 */
class PhotocraftApp : Application() {

    lateinit var settings: SettingsRepository
        private set

    lateinit var projects: ProjectStore
        private set

    lateinit var assets: AssetRepository
        private set

    lateinit var brandKit: BrandKitRepository
        private set

    lateinit var models: ModelManager
        private set

    /** Null when the native library could not be loaded: every screen shows a clear error. */
    var engineError: String? = null
        private set

    override fun onCreate() {
        super.onCreate()
        settings = SettingsRepository(this)
        projects = ProjectStore(this)
        assets = AssetRepository(this)
        brandKit = BrandKitRepository(this)
        models = ModelManager(this)

        engineError = runCatching {
            NativeBridge.load()
            null
        }.getOrElse { e ->
            android.util.Log.e(TAG, "the PhotoCraft engine could not be loaded", e)
            e.message ?: "unknown error"
        }
    }

    companion object {
        private const val TAG = "PhotocraftApp"

        fun of(context: android.content.Context): PhotocraftApp =
            context.applicationContext as PhotocraftApp
    }
}
