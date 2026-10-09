package com.photocraft.mobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultNewArchitectureSettings.fabricEnabled
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import com.photocraft.mobile.ai.OcrModule
import com.photocraft.mobile.ai.BackgroundRemovalModule
import com.photocraft.mobile.engine.PhotoCraftModule
import com.photocraft.mobile.support.AssetsModule
import com.photocraft.mobile.support.DocumentPickerModule
import com.photocraft.mobile.support.FileTextModule

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        object : ReactNativeHost(this) {
            override fun getPackages(): MutableList<ReactPackage> =
                PackageList(this).packages.apply {
                    add(PhotoCraftAppPackage())
                }

            override fun getJSMainModuleName(): String = "index"
            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG
            override val isNewArchEnabled: Boolean = true
            override val isHermesEnabled: Boolean = true
        }

    override val reactHost: ReactHost
        get() = ReactNativeHostUtils.createReactHost(applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()
        SoLoader.init(this, OpenSourceMergedSoMapping)
        load(this, fabricEnabled)
    }
}

/** Native packages: the engine bridge and the two on-device AI modules. */
class PhotoCraftAppPackage : ReactPackage {
    override fun createNativeModules(reactContext: com.facebook.react.bridge.ReactApplicationContext) =
        listOf(
            PhotoCraftModule(reactContext),
            OcrModule(reactContext),
            BackgroundRemovalModule(reactContext),
            FileTextModule(reactContext),
            DocumentPickerModule(reactContext),
            AssetsModule(reactContext),
        )

    override fun createViewManagers(reactContext: com.facebook.react.bridge.ReactApplicationContext) =
        emptyList<com.facebook.react.uimanager.ViewManager<*, *>>()
}

private object ReactNativeHostUtils {
    fun createReactHost(
        context: android.content.Context,
        host: ReactNativeHost,
    ): ReactHost =
        com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost(context, host)
}
