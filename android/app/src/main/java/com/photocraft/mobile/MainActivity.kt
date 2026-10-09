package com.photocraft.mobile

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import java.io.File
import java.util.concurrent.Executors

/**
 * The launcher activity. The manifest declares ACTION_SEND / ACTION_VIEW image
 * filters ("share/open with Photo Craft") — this class actually stages those
 * images into `filesDir/inbox/last.png`, where the AI workspaces (OCR,
 * background removal) pick them up through `core/staging.ts`.
 */
class MainActivity : ReactActivity() {

    private val staging = Executors.newSingleThreadExecutor { r -> Thread(r, "photocraft-stage") }

    override fun getMainComponentName(): String = "PhotoCraftMobile"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        object : ReactActivityDelegate(this, mainComponentName) {
            override fun fabricEnabled(): Boolean = fabricEnabled
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(null)
        stageInboxImage(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // singleTask launchMode: shares while the app is open arrive here.
        setIntent(intent)
        stageInboxImage(intent)
    }

    /** Copy a shared/opened image into the inbox, ignoring cancellations quietly. */
    private fun stageInboxImage(intent: Intent?) {
        if (intent == null) return
        val uri: Uri = when (intent.action) {
            Intent.ACTION_SEND ->
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(Intent.EXTRA_STREAM) ?: return
            Intent.ACTION_VIEW -> intent.data ?: return
            else -> return
        }
        staging.execute {
            try {
                val inbox = File(filesDir, "inbox").apply { mkdirs() }
                val out = File(inbox, "last.png")
                contentResolver.openInputStream(uri)?.use { input ->
                    out.outputStream().use { output -> input.copyTo(output) }
                } ?: return@execute
            } catch (_: Exception) {
                // Unreadable/expired share payload — the inbox simply stays as-is;
                // the workspaces surface the absence, no false success here.
            }
        }
    }
}
