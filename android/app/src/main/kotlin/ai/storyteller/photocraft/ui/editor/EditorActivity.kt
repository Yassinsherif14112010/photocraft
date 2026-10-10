package ai.storyteller.photocraft.ui.editor

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import ai.storyteller.photocraft.PhotocraftApp
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.core.CommandException
import ai.storyteller.photocraft.core.DocumentInfo
import ai.storyteller.photocraft.core.Engine
import ai.storyteller.photocraft.core.onEngine
import ai.storyteller.photocraft.data.DocumentPreset
import ai.storyteller.photocraft.data.Project
import ai.storyteller.photocraft.data.SettingsRepository
import ai.storyteller.photocraft.databinding.ActivityEditorBinding
import ai.storyteller.photocraft.ui.common.snack
import ai.storyteller.photocraft.ui.common.windowSizeClass
import ai.storyteller.photocraft.util.looksImportable
import ai.storyteller.photocraft.util.readPickedFile
import ai.storyteller.photocraft.util.writeToPrivateFile
import kotlin.math.max
import kotlin.math.min

/**
 * The editor.
 *
 * Everything the user does here goes through the real engine:
 *   [Engine.execute] → the engine's command registry → a real document mutation → history →
 *   [Engine.render] → the compositor → the canvas → [Engine.savePcraft] → the native format.
 *
 * The activity owns no document state of its own: the panels and the top bar are refreshed from
 * [DocumentInfo], which is read back from the engine after every command.
 */
class EditorActivity : AppCompatActivity(), EditorContext {

    private lateinit var binding: ActivityEditorBinding
    private lateinit var app: PhotocraftApp

    private var engine: Engine? = null
    private var projectId: String? = null
    private var project: Project? = null
    private var info: DocumentInfo? = null

    private var currentPanel: EditorPanel? = null
    private val panels = LinkedHashMap<String, EditorPanel>()

    private var dirty = false
    private var autosaveJob: Job? = null
    private var renderJob: Job? = null

    private var openExportOnLoad = false

    private val pickImage = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri != null) placeImage(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityEditorBinding.inflate(layoutInflater)
        setContentView(binding.root)
        app = PhotocraftApp.of(this)

        projectId = intent.getStringExtra(EXTRA_PROJECT_ID)
        openExportOnLoad = intent.getBooleanExtra(EXTRA_OPEN_EXPORT, false)

        setSupportActionBar(binding.topBar.editorTopBar)
        supportActionBar?.setDisplayShowTitleEnabled(false)

        app.engineError?.let {
            binding.root.snack(getString(R.string.common_engine_error, it), long = true)
        }

        configureAdaptiveLayout()
        wireTopBar()
        wireTools()
        registerPanels()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (currentPanel != null) closePanel() else confirmClose()
            }
        })

        loadDocument()
    }

    // ---- layout -------------------------------------------------------------

    /**
     * One layout, sized by the real window: the side panel appears from the medium width class up
     * (tablets, unfolded foldables, landscape, split-screen) and the bottom sheet hosts the same
     * panels on a phone.
     */
    private fun configureAdaptiveLayout() {
        // The side panel is filled when a tool is opened (see togglePanel): from the medium width
        // class up (tablets, unfolded foldables, split-screen) it sits beside the canvas, on a
        // phone the same panel goes into the bottom sheet. Nothing is hard-coded per device.
        binding.sidePanel.visibility = View.GONE
        binding.bottomSheetPanel.visibility = View.GONE
    }

    private fun wireTopBar() {
        binding.topBar.editorTopBar.setNavigationOnClickListener { confirmClose() }
        binding.topBar.editorTopBar.setOnMenuItemClickListener {
            when (it.itemId) {
                R.id.action_undo -> runCommand("edit.undo")
                R.id.action_redo -> runCommand("edit.redo")
                R.id.action_save -> saveProject()
                R.id.action_export -> showExportSheet()
                R.id.action_duplicate -> duplicateProject()
                R.id.action_info -> showDocumentInfo()
                R.id.action_settings -> startActivity(
                    Intent(this, ai.storyteller.photocraft.ui.settings.SettingsActivity::class.java)
                )
            }
            true
        }
    }

    private fun wireTools() {
        val toolFor = mapOf(
            R.id.toolLayers to "layers",
            R.id.toolText to "text",
            R.id.toolAdjust to "adjust",
            R.id.toolTransform to "transform",
            R.id.toolAi to "ai",
            R.id.toolAssets to "assets",
            R.id.toolCrop to "transform"
        )
        toolFor.forEach { (viewId, panelId) ->
            binding.root.findViewById<View>(viewId)?.setOnClickListener { togglePanel(panelId) }
        }
        binding.canvas.setOnLongClickListener { false }
    }

    private fun registerPanels() {
        panels["layers"] = LayersPanel()
        panels["text"] = TextPanel()
        panels["adjust"] = AdjustPanel()
        panels["transform"] = TransformPanel()
        panels["ai"] = AiPanel()
        panels["assets"] = AssetsPanel { pickImage.launch("image/*") }
    }

    private fun togglePanel(id: String) {
        if (currentPanel?.id == id) {
            closePanel()
            return
        }
        currentPanel?.onDetached()
        val panel = panels[id] ?: return
        currentPanel = panel
        val host = object : EditorPanelHost {
            override fun requestClose() = closePanel()
        }
        val view = panel.createView(this, host)
        val sizeClass = windowSizeClass()
        if (sizeClass.supportsSidePanel) {
            binding.sidePanelContent.removeAllViews()
            binding.sidePanelContent.addView(view)
            binding.sidePanel.visibility = View.VISIBLE
            binding.bottomSheetPanel.visibility = View.GONE
        } else {
            binding.bottomSheetPanel.removeAllViews()
            binding.bottomSheetPanel.addView(view)
            binding.bottomSheetPanel.visibility = View.VISIBLE
            binding.sidePanel.visibility = View.GONE
        }
        highlightTool(id)
        panel.refresh(info)
    }

    private fun highlightTool(id: String) {
        val selected = mapOf(
            "layers" to R.id.toolLayers,
            "text" to R.id.toolText,
            "adjust" to R.id.toolAdjust,
            "transform" to R.id.toolTransform,
            "ai" to R.id.toolAi,
            "assets" to R.id.toolAssets
        )[id]
        for (viewId in listOf(R.id.toolLayers, R.id.toolText, R.id.toolAdjust, R.id.toolTransform, R.id.toolAi, R.id.toolAssets, R.id.toolCrop)) {
            val button = binding.root.findViewById<com.google.android.material.button.MaterialButton>(viewId)
            button?.setIconTintResource(if (viewId == selected) R.color.pc_tool_active else R.color.pc_tool_inactive)
        }
    }

    override fun closePanel() {
        currentPanel?.onDetached()
        currentPanel = null
        binding.sidePanelContent.removeAllViews()
        binding.bottomSheetPanel.removeAllViews()
        binding.sidePanel.visibility = View.GONE
        binding.bottomSheetPanel.visibility = View.GONE
        highlightTool("")
    }

    // ---- document -----------------------------------------------------------

    private fun loadDocument() {
        lifecycleScope.launch {
            binding.canvasProgress.visibility = View.VISIBLE
            val result = runCatching {
                onEngine {
                    val id = projectId
                    if (id != null) {
                        val stored = app.projects.get(id)
                        project = stored
                        if (stored != null && java.io.File(stored.path).isFile) {
                            Engine.openPath(stored.path)
                        } else {
                            Engine.newDocument(1080, 1080)
                        }
                    } else {
                        val presetId = intent.getStringExtra(EXTRA_PRESET_ID)
                        val preset = presetId?.let { DocumentPreset.byId(it) } ?: DocumentPreset.ALL.first()
                        Engine.newDocument(
                            width = preset.width,
                            height = preset.height,
                            background = preset.background.name.lowercase(),
                            name = getString(R.string.newproject_title),
                            resolution = preset.resolution
                        )
                    }
                }
            }
            binding.canvasProgress.visibility = View.GONE
            result.onSuccess { opened ->
                engine = opened
                refresh()
                if (openExportOnLoad) {
                    openExportOnLoad = false
                    showExportSheet()
                }
            }.onFailure { e ->
                binding.root.snack(getString(R.string.common_error, e.message ?: ""), long = true)
                finish()
            }
        }
    }

    override fun refresh() {
        val current = engine ?: return
        renderJob?.cancel()
        renderJob = lifecycleScope.launch {
            val next = runCatching { onEngine { current.info() } }.getOrNull() ?: return@launch
            info = next
            binding.topBar.title.text = next.name.ifBlank { project?.name ?: getString(R.string.title_editor) }
            binding.topBar.status.text = if (dirty) {
                getString(R.string.editor_unsaved)
            } else {
                getString(R.string.editor_document_info, next.width, next.height, next.mode.uppercase())
            }
            binding.topBar.status.setTextColor(
                getColor(if (dirty) R.color.pc_state_unsaved else R.color.pc_state_saved)
            )
            binding.topBar.editorTopBar.menu.findItem(R.id.action_undo)?.isEnabled = next.canUndo
            binding.topBar.editorTopBar.menu.findItem(R.id.action_redo)?.isEnabled = next.canRedo

            currentPanel?.refresh(next)
            renderCanvas(current, next)
        }
    }

    /** Renders at the size the canvas actually needs — never the full document for a phone screen. */
    private suspend fun renderCanvas(current: Engine, next: DocumentInfo) {
        val sizeClass = windowSizeClass()
        val budget = resources.getInteger(
            if (sizeClass.isTabletLike) R.integer.render_max_side_tablet else R.integer.render_max_side_phone
        )
        val viewLongSide = max(binding.canvasHost.width, binding.canvasHost.height)
        val target = min(budget, max(256, viewLongSide * 2))
        val bitmap = runCatching { onEngine { current.render(target) } }.getOrNull() ?: return
        binding.canvas.setDocument(bitmap, keepViewTransform = true)
    }

    override fun runCommand(command: String, params: JSONObject, undoLabel: Int) {
        val current = engine ?: return
        lifecycleScope.launch {
            val result = runCatching { onEngine { current.execute(command, params) } }
            result.onFailure { e ->
                val message = if (e is CommandException) e.message else e.message
                showMessage(message ?: getString(R.string.common_error, command))
            }.onSuccess {
                markDirty()
                refresh()
            }
        }
    }

    private fun markDirty() {
        dirty = true
        scheduleAutosave()
    }

    private fun scheduleAutosave() {
        autosaveJob?.cancel()
        if (!app.settings.current().autosave) return
        autosaveJob = lifecycleScope.launch {
            delay(app.settings.current().autosaveSeconds * 1000L)
            saveProject(silent = true)
        }
    }

    private fun saveProject(silent: Boolean = false) {
        val current = engine ?: return
        lifecycleScope.launch {
            val result = runCatching {
                onEngine {
                    val bytes = current.savePcraft()
                    val id = projectId ?: app.projects.newId().also { projectId = it }
                    val file = app.projects.documentFile(id)
                    file.writeBytes(bytes)
                    val infoNow = current.info()
                    val stored = app.projects.get(id) ?: Project(
                        id = id,
                        name = infoNow.name,
                        path = file.absolutePath,
                        width = infoNow.width,
                        height = infoNow.height,
                        updatedAt = System.currentTimeMillis(),
                        thumbnailPath = null
                    )
                    val updated = stored.copy(
                        name = infoNow.name.ifBlank { stored.name },
                        width = infoNow.width,
                        height = infoNow.height,
                        path = file.absolutePath,
                        updatedAt = System.currentTimeMillis()
                    )
                    app.projects.upsert(updated)
                    val thumb = current.render(512)
                    app.projects.saveThumbnail(id, thumb)
                    thumb.recycle()
                    project = app.projects.get(id)
                }
            }
            result.onSuccess {
                dirty = false
                refresh()
                if (!silent) binding.root.snack(getString(R.string.editor_saved_toast))
                else Toast.makeText(this@EditorActivity, R.string.editor_autosaved, Toast.LENGTH_SHORT).show()
            }.onFailure { e ->
                showMessage(getString(R.string.common_error, e.message ?: ""))
            }
        }
    }

    private fun duplicateProject() {
        lifecycleScope.launch {
            val id = projectId ?: return@launch
            val copy = runCatching {
                val source = app.projects.get(id) ?: return@runCatching null
                val newId = app.projects.newId()
                val target = app.projects.documentFile(newId)
                target.writeBytes(java.io.File(source.path).readBytes())
                val project = source.copy(
                    id = newId,
                    name = source.name + " " + getString(R.string.home_menu_duplicate),
                    path = target.absolutePath,
                    updatedAt = System.currentTimeMillis()
                )
                app.projects.upsert(project)
                project
            }.getOrNull()
            if (copy != null) {
                startActivity(
                    Intent(this@EditorActivity, EditorActivity::class.java)
                        .putExtra(EXTRA_PROJECT_ID, copy.id)
                )
                finish()
            }
        }
    }

    private fun showDocumentInfo() {
        val next = info ?: return
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.editor_menu_info)
            .setMessage(
                getString(R.string.editor_document_info, next.width, next.height, next.mode.uppercase()) +
                    "\n" + getString(R.string.layers_title) + ": " + next.layers.size +
                    "\n" + getString(R.string.ai_keep_model, next.depth.toString() + " bit")
            )
            .setPositiveButton(R.string.common_ok, null)
            .show()
    }

    // ---- import into the document -------------------------------------------

    private fun placeImage(uri: android.net.Uri) {
        lifecycleScope.launch {
            val (picked, error) = readPickedFile(uri)
            if (picked == null) {
                showMessage(error ?: getString(R.string.import_unsupported))
                return@launch
            }
            if (!looksImportable(picked.name, picked.mime)) {
                showMessage(getString(R.string.import_unsupported))
                return@launch
            }
            // The engine's `file.placeEmbedded` reads a real path, so the bytes are copied into the
            // app's private storage first: a content URI may be revoked at any time.
            val path = writeToPrivateFile(picked.bytes, picked.name)
            runCommand(
                "file.placeEmbedded",
                JSONObject().put("path", path).put("fit", true)
            )
            showMessage(getString(R.string.import_placed))
        }
    }

    // ---- export --------------------------------------------------------------

    private fun showExportSheet() {
        val infoNow = info ?: return
        val sheet = ExportSheet.newInstance(
            width = infoNow.width,
            height = infoNow.height,
            defaultFormat = app.settings.current().exportFormat
        )
        sheet.show(supportFragmentManager, ExportSheet.TAG)
    }

    // ---- lifecycle ------------------------------------------------------------

    private fun confirmClose() {
        if (!dirty) {
            finish()
            return
        }
        MaterialAlertDialogBuilder(this)
            .setMessage(R.string.editor_close_discard)
            .setNegativeButton(R.string.editor_close_discard_action) { _, _ -> finish() }
            .setPositiveButton(R.string.editor_close_save) { _, _ ->
                saveProject()
                lifecycleScope.launch {
                    delay(400)
                    finish()
                }
            }
            .show()
    }

    override fun onStop() {
        super.onStop()
        if (dirty && app.settings.current().autosave) saveProject(silent = true)
    }

    override fun onDestroy() {
        super.onDestroy()
        autosaveJob?.cancel()
        currentPanel?.onDetached()
        binding.canvas.release()
        val current = engine
        engine = null
        lifecycleScope.launch {
            runCatching { onEngine { current?.close() } }
        }
    }

    // ---- EditorContext ---------------------------------------------------------

    override fun engine(): Engine? = engine

    override fun documentInfo(): DocumentInfo? = info

    override fun showMessage(text: String) = binding.root.snack(text, long = true)

    override fun showMessage(resId: Int, vararg args: Any) =
        binding.root.snack(getString(resId, *args), long = true)

    override fun scope(): androidx.lifecycle.LifecycleCoroutineScope = lifecycleScope

    override fun app(): PhotocraftApp = app

    override fun settings(): SettingsRepository = app.settings

    companion object {
        const val EXTRA_PROJECT_ID = "project_id"
        const val EXTRA_PRESET_ID = "preset_id"
        const val EXTRA_OPEN_EXPORT = "open_export"
    }
}
