package ai.storyteller.photocraft.ui.editor

import androidx.lifecycle.LifecycleCoroutineScope
import ai.storyteller.photocraft.PhotocraftApp
import ai.storyteller.photocraft.core.DocumentInfo
import ai.storyteller.photocraft.core.Engine
import ai.storyteller.photocraft.data.SettingsRepository
import org.json.JSONObject

/**
 * What a panel needs from the editor, and nothing more: panels never touch the engine handle
 * directly, so every edit goes through one place that records history, marks the project dirty and
 * re-renders the canvas.
 */
interface EditorContext {

    /** The open engine, or null while a document is loading or after a failure. */
    fun engine(): Engine?

    /** The last document state the editor read from the engine. */
    fun documentInfo(): DocumentInfo?

    /**
     * Runs an engine command by id. The call is dispatched to the engine thread; failures are
     * shown to the user, and a successful command refreshes the canvas and the panels.
     */
    fun runCommand(command: String, params: JSONObject = JSONObject(), undoLabel: Int = 0)

    /** Re-reads the document and re-renders the canvas. */
    fun refresh()

    fun showMessage(text: String)

    fun showMessage(resId: Int, vararg args: Any)

    fun scope(): LifecycleCoroutineScope

    fun app(): PhotocraftApp

    fun settings(): SettingsRepository

    /** Closes the panel (used after an action that makes the panel irrelevant). */
    fun closePanel()
}

/** A bottom-sheet / side-panel section of the editor. */
interface EditorPanel {

    /** Stable id, also used as the toolbar button tag. */
    val id: String

    fun createView(context: EditorContext, parent: EditorPanelHost): android.view.View

    /** Called after the document state changed. */
    fun refresh(info: DocumentInfo?)

    /** Called when the panel is removed from the screen. */
    fun onDetached() = Unit
}

/** The container that hosts a panel (bottom sheet on phones, side panel on tablets). */
interface EditorPanelHost {
    fun requestClose()
}
