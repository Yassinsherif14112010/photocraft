package com.photocraft.mobile

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "PhotoCraftMobile"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        object : ReactActivityDelegate(this, mainComponentName) {
            override fun fabricEnabled(): Boolean = fabricEnabled
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(null)
    }
}
