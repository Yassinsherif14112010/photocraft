package ai.storyteller.photocraft.ui.home

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import kotlinx.coroutines.launch
import androidx.lifecycle.lifecycleScope
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import ai.storyteller.photocraft.PhotocraftApp
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.core.Engine
import ai.storyteller.photocraft.core.onEngine
import ai.storyteller.photocraft.data.DocumentPreset
import ai.storyteller.photocraft.data.Project
import ai.storyteller.photocraft.databinding.ActivityHomeBinding
import ai.storyteller.photocraft.ui.assets.AssetLibraryActivity
import ai.storyteller.photocraft.ui.brandkit.BrandKitActivity
import ai.storyteller.photocraft.ui.common.gridSpan
import ai.storyteller.photocraft.ui.common.snack
import ai.storyteller.photocraft.ui.common.windowSizeClass
import ai.storyteller.photocraft.ui.editor.EditorActivity
import ai.storyteller.photocraft.ui.settings.SettingsActivity
import ai.storyteller.photocraft.ui.templates.NewProjectSheet
import ai.storyteller.photocraft.ui.templates.TemplatesActivity
import ai.storyteller.photocraft.util.IMPORTABLE_MIME_TYPES
import ai.storyteller.photocraft.util.looksImportable
import ai.storyteller.photocraft.util.readPickedFile
import ai.storyteller.photocraft.util.writeToPrivateFile

/**
 * Home: recent projects, continue editing, new project, import and search.
 *
 * Every entry point creates or opens a **real** engine document:
 *  * New project → `file.new` with the preset's size and background;
 *  * Import → the file's bytes are handed to the engine's importer (`photocraft_io::import`), which
 *    detects PSD/PSB, Affinity, camera raws and flat images by magic;
 *  * Open → the `.pcraft` path is opened with the native loader, so layers survive.
 */
class HomeActivity : AppCompatActivity() {

    private lateinit var binding: ActivityHomeBinding
    private lateinit var app: PhotocraftApp
    private lateinit var adapter: ProjectAdapter

    private var query: String = ""

    /** Opens a file (import). Accepts images, PSD and `.pcraft`. */
    private val pickFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) openUri(uri)
    }

    /** The photo picker (Android's visual media picker where available). */
    private val pickPhoto = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) openUri(uri)
    }

    private val templates = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val id = result.data?.getStringExtra(TemplatesActivity.EXTRA_PRESET_ID) ?: return@registerForActivityResult
        DocumentPreset.byId(id)?.let { preset ->
            createDocument(
                width = preset.width,
                height = preset.height,
                background = preset.background,
                name = presetName(preset),
                presetId = preset.id,
                resolution = preset.resolution
            )
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityHomeBinding.inflate(layoutInflater)
        setContentView(binding.root)
        app = PhotocraftApp.of(this)

        app.engineError?.let {
            binding.root.snack(getString(R.string.common_engine_error, it), long = true)
        }

        setupToolbar()
        setupGrid()
        setupSearch()

        binding.fabNew.setOnClickListener { showNewProjectSheet() }
        binding.swipeRefresh.setOnRefreshListener { refresh() }

        refresh()
        handleIncomingIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    // ---- wiring -------------------------------------------------------------

    private fun setupToolbar() {
        binding.toolbar.setNavigationOnClickListener { showNewProjectSheet() }
        binding.toolbar.setOnMenuItemClickListener {
            when (it.itemId) {
                R.id.action_import -> showImportMenu()
                R.id.action_templates -> startTemplates()
                R.id.action_assets -> startActivity(Intent(this, AssetLibraryActivity::class.java))
                R.id.action_brand_kit -> startActivity(Intent(this, BrandKitActivity::class.java))
                R.id.action_settings -> startActivity(Intent(this, SettingsActivity::class.java))
            }
            true
        }
    }

    private fun setupGrid() {
        val span = gridSpan(this, windowSizeClass())
        binding.recycler.layoutManager = GridLayoutManager(this, span)
        adapter = ProjectAdapter(
            onOpen = { openProject(it) },
            onAction = { project, action -> onProjectAction(project, action) }
        )
        binding.recycler.adapter = adapter
    }

    private fun setupSearch() {
        binding.searchInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                query = s?.toString().orEmpty()
                refresh()
            }
        })
    }

    // ---- data ---------------------------------------------------------------

    private fun refresh() {
        lifecycleScope.launch {
            app.projects.pruneMissing()
            val list = app.projects.recent(query)
            adapter.submitList(list)
            val empty = list.isEmpty()
            binding.emptyState.visibility = if (empty) View.VISIBLE else View.GONE
            binding.recycler.visibility = if (empty) View.GONE else View.VISIBLE
            if (empty) {
                binding.emptyTitle.text = if (query.isBlank()) {
                    getString(R.string.home_empty_title)
                } else {
                    getString(R.string.home_empty_search, query)
                }
                binding.emptyBody.setText(R.string.home_empty_body)
            }
            binding.swipeRefresh.isRefreshing = false
        }
    }

    private fun onProjectAction(project: Project, action: ProjectAdapter.Action) {
        when (action) {
            ProjectAdapter.Action.RENAME -> renameProject(project)
            ProjectAdapter.Action.DUPLICATE -> duplicateProject(project)
            ProjectAdapter.Action.EXPORT -> openProject(project, export = true)
            ProjectAdapter.Action.DELETE -> confirmDelete(project)
        }
    }

    private fun renameProject(project: Project) {
        val input = TextInputEditText(this).apply { setText(project.name) }
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.home_menu_rename)
            .setView(input)
            .setNegativeButton(R.string.common_cancel, null)
            .setPositiveButton(R.string.common_save) { _, _ ->
                val name = input.text?.toString()?.trim().orEmpty()
                if (name.isNotEmpty()) {
                    lifecycleScope.launch {
                        app.projects.rename(project.id, name)
                        refresh()
                    }
                }
            }
            .show()
    }

    private fun duplicateProject(project: Project) {
        lifecycleScope.launch {
            runCatching {
                val bytes = java.io.File(project.path).readBytes()
                val id = app.projects.newId()
                val target = app.projects.documentFile(id)
                target.writeBytes(bytes)
                val copy = project.copy(
                    id = id,
                    name = getString(R.string.home_menu_duplicate) + " " + project.name,
                    path = target.absolutePath,
                    updatedAt = System.currentTimeMillis()
                )
                app.projects.upsert(copy)
            }
            refresh()
        }
    }

    private fun confirmDelete(project: Project) {
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.home_menu_delete)
            .setMessage(getString(R.string.home_delete_confirm, project.name))
            .setNegativeButton(R.string.common_cancel, null)
            .setPositiveButton(R.string.common_delete) { _, _ ->
                lifecycleScope.launch {
                    app.projects.delete(project.id)
                    binding.root.snack(getString(R.string.home_delete_done))
                    refresh()
                }
            }
            .show()
    }

    // ---- creating and opening ----------------------------------------------

    private fun showNewProjectSheet() {
        val sheet = NewProjectSheet()
        sheet.onCreated = { request ->
            createDocument(
                width = request.width,
                height = request.height,
                background = request.background,
                name = request.name,
                presetId = request.presetId
            )
        }
        sheet.show(supportFragmentManager, NewProjectSheet.TAG)
    }

    private fun createDocument(
        width: Int,
        height: Int,
        background: DocumentPreset.Background,
        name: String,
        presetId: String?,
        resolution: Int = 72
    ) {
        lifecycleScope.launch {
            val result = runCatching {
                onEngine {
                    val engine = Engine.newDocument(
                        width = width,
                        height = height,
                        background = background.name.lowercase(),
                        name = name,
                        resolution = resolution
                    )
                    val id = app.projects.newId()
                    val file = app.projects.documentFile(id)
                    file.writeBytes(engine.savePcraft())
                    val project = Project(
                        id = id,
                        name = name,
                        path = file.absolutePath,
                        width = width,
                        height = height,
                        updatedAt = System.currentTimeMillis(),
                        thumbnailPath = null,
                        presetId = presetId
                    )
                    app.projects.upsert(project)
                    val bitmap = engine.render(512)
                    app.projects.saveThumbnail(id, bitmap)
                    bitmap.recycle()
                    engine.close()
                    app.projects.get(id)!!
                }
            }
            result.onSuccess { project -> openProject(project) }
                .onFailure { e -> binding.root.snack(getString(R.string.common_error, e.message ?: ""), long = true) }
        }
    }

    private fun openProject(project: Project, export: Boolean = false) {
        val intent = Intent(this, EditorActivity::class.java)
            .putExtra(EditorActivity.EXTRA_PROJECT_ID, project.id)
        if (export) intent.putExtra(EditorActivity.EXTRA_OPEN_EXPORT, true)
        startActivity(intent)
    }

    // ---- import --------------------------------------------------------------

    /** Handles ACTION_SEND (share a photo into PhotoCraft) and ACTION_VIEW (open a file). */
    private fun handleIncomingIntent(intent: Intent?) {
        val action = intent?.action ?: return
        when (action) {
            Intent.ACTION_SEND -> {
                val uri = intent.parcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM)
                if (uri != null) openUri(uri)
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val uris = intent.parcelableArrayListExtra<android.net.Uri>(Intent.EXTRA_STREAM)
                uris?.firstOrNull()?.let { openUri(it) }
            }
            Intent.ACTION_VIEW -> {
                val uri = intent.data
                if (uri != null) openUri(uri)
            }
        }
    }

    private inline fun <reified T : android.os.Parcelable> Intent.parcelableExtra(key: String): T? =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            getParcelableExtra(key, T::class.java)
        } else {
            @Suppress("DEPRECATION")
            getParcelableExtra(key) as? T
        }

    private inline fun <reified T : android.os.Parcelable> Intent.parcelableArrayListExtra(key: String): ArrayList<T>? =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            getParcelableArrayListExtra(key, T::class.java)
        } else {
            @Suppress("DEPRECATION")
            getParcelableArrayListExtra(key)
        }

    fun showImportMenu() {
        val items = arrayOf(
            getString(R.string.import_from_photos),
            getString(R.string.import_from_files)
        )
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.import_title)
            .setItems(items) { _, which ->
                if (which == 0) pickPhoto.launch("image/*") else pickFile.launch(IMPORTABLE_MIME_TYPES)
            }
            .show()
    }

    /**
     * Imports a file into a new project: the bytes go through the engine's importer, and the
     * result is saved as a native `.pcraft` project so the user keeps every layer.
     */
    private fun openUri(uri: android.net.Uri) {
        lifecycleScope.launch {
            val (picked, error) = readPickedFile(uri)
            if (picked == null) {
                binding.root.snack(error ?: getString(R.string.import_unsupported), long = true)
                return@launch
            }
            if (!looksImportable(picked.name, picked.mime)) {
                binding.root.snack(getString(R.string.import_unsupported), long = true)
                return@launch
            }
            val result = runCatching {
                onEngine {
                    val engine = Engine.openBytes(picked.name, picked.bytes)
                    val info = engine.info()
                    val id = app.projects.newId()
                    val file = app.projects.documentFile(id)
                    file.writeBytes(engine.savePcraft())
                    val project = Project(
                        id = id,
                        name = picked.name.substringBeforeLast('.'),
                        path = file.absolutePath,
                        width = info.width,
                        height = info.height,
                        updatedAt = System.currentTimeMillis(),
                        thumbnailPath = null
                    )
                    app.projects.upsert(project)
                    val bitmap = engine.render(512)
                    app.projects.saveThumbnail(id, bitmap)
                    bitmap.recycle()
                    val warnings = engine.warnings()
                    engine.close()
                    (app.projects.get(id) ?: project) to warnings
                }
            }
            result.onSuccess { (project, warnings) ->
                if (warnings.isNotEmpty()) {
                    binding.root.snack(getString(R.string.import_warnings) + ": " + warnings.first(), long = true)
                }
                openProject(project)
            }.onFailure { e ->
                binding.root.snack(
                    getString(R.string.import_failed, picked.name, e.message ?: ""),
                    long = true
                )
            }
        }
    }

    private fun presetName(preset: DocumentPreset): String {
        val id = resources.getIdentifier(preset.nameRes, "string", packageName)
        return if (id != 0) getString(id) else preset.id
    }

    /** Entry point used by the empty state's buttons. */
    fun startTemplates() {
        templates.launch(Intent(this, TemplatesActivity::class.java))
    }

    companion object {
        /** Kept for `writeToPrivateFile` consumers inside the package. */
        const val IMPORT_DIR = "imports"
    }
}
