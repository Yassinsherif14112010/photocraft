package ai.storyteller.photocraft.ui.editor

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.view.LayoutInflater
import android.view.View
import android.widget.ArrayAdapter
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.ai.BackgroundRemover
import ai.storyteller.photocraft.ai.RemovalException
import ai.storyteller.photocraft.core.DocumentInfo
import ai.storyteller.photocraft.core.onEngine
import ai.storyteller.photocraft.databinding.ViewPanelAiBinding
import ai.storyteller.photocraft.ui.common.formatBytes

/**
 * Background removal.
 *
 * Two paths, both real and both on-device. They are never presented as the same thing:
 *
 *  * **Quick Remove** runs the engine's own Select Subject + Refine Edge + layer mask
 *    (pure Rust: `crates/algo/src/segment`, no neural network, no download, works offline). The
 *    result is a non-destructive layer mask, one undo step.
 *  * **High-quality Remove** runs a BiRefNet / U²-Net ONNX model with ONNX Runtime, downloads it
 *    on demand ([ai.storyteller.photocraft.ai.ModelManager]) and turns the model's probability map
 *    into the same kind of layer mask. When the model is missing, the panel says so and offers the
 *    download; it never pretends the removal happened.
 *
 * Neither path ever resizes or flattens the live document: the mask is produced at the document's
 * own pixel size and applied by the engine as a mask.
 */
class AiPanel : BasePanel() {

    override val id: String = "ai"

    private var binding: ViewPanelAiBinding? = null
    private var info: DocumentInfo? = null
    private var remover: BackgroundRemover? = null

    private var downloadJob: Job? = null
    private var removalJob: Job? = null

    @Volatile
    private var cancelled = false

    override fun inflate(inflater: LayoutInflater): View =
        ViewPanelAiBinding.inflate(inflater).also { binding = it }.root

    override fun onViewCreated(view: View) {
        val b = binding ?: return
        val specs = context.app().models.specs
        b.modelSpinner.adapter = ArrayAdapter(
            view.context,
            android.R.layout.simple_spinner_dropdown_item,
            specs.map { it.label }
        )
        b.quickRun.setOnClickListener { quickRemove() }
        b.selectSubject.setOnClickListener { run("select.subject") }
        b.selectSky.setOnClickListener { run("select.sky") }
        b.downloadModel.setOnClickListener { downloadSelected() }
        b.cancelButton.setOnClickListener { cancel() }
        b.hqRun.setOnClickListener { highQualityRemove() }
        refreshModelState()
    }

    // ---- quick (engine, no model) ------------------------------------------

    /**
     * The engine's own subject selection, refined, then turned into a layer mask that hides the
     * background. Three real command calls, each undoable, none of them destructive.
     */
    private fun quickRemove() {
        context.scope().launch {
            val engine = context.engine() ?: return@launch
            context.showMessage(R.string.ai_working)
            val result = runCatching {
                onEngine {
                    engine.execute("select.subject", org.json.JSONObject())
                    engine.execute(
                        "select.refineEdge",
                        org.json.JSONObject()
                            .put("radius", 4)
                            .put("smartRadius", true)
                            .put("smooth", 3)
                            .put("feather", 1)
                            .put("output", "selection")
                    )
                    engine.execute("layer.layerMask.revealSelection", org.json.JSONObject())
                    engine.execute("layer.matting.defringe", org.json.JSONObject().put("width", 1))
                }
            }
            result.onSuccess { context.showMessage(R.string.ai_applied); context.refresh() }
                .onFailure { context.showMessage(R.string.ai_failed, it.message ?: "") }
        }
    }

    // ---- high quality (ONNX) -------------------------------------------------

    private fun selectedSpec() =
        context.app().models.specs.getOrNull(binding?.modelSpinner?.selectedItemPosition ?: 0)

    private fun refreshModelState() {
        val b = binding ?: return
        val models = context.app().models
        val spec = selectedSpec() ?: return
        when (models.status(spec)) {
            ai.storyteller.photocraft.ai.ModelStatus.VALID -> {
                b.modelState.text = b.root.context.getString(R.string.ai_model_state_valid)
                b.modelState.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_check, 0, 0, 0)
                b.downloadModel.isEnabled = false
                b.hqRun.isEnabled = true
            }
            ai.storyteller.photocraft.ai.ModelStatus.CORRUPT -> {
                b.modelState.text = b.root.context.getString(R.string.ai_model_state_corrupt)
                b.downloadModel.isEnabled = true
                b.hqRun.isEnabled = false
            }
            ai.storyteller.photocraft.ai.ModelStatus.MISSING -> {
                b.modelState.text = b.root.context.getString(R.string.ai_model_state_missing)
                b.downloadModel.isEnabled = true
                b.hqRun.isEnabled = false
            }
        }
        b.downloadModel.text = b.root.context.getString(
            R.string.ai_download_model,
            formatBytes(spec.bytes.takeIf { it > 0 } ?: spec.minBytes)
        )
    }

    private fun downloadSelected() {
        val b = binding ?: return
        val models = context.app().models
        val spec = selectedSpec() ?: return
        val androidContext = b.root.context
        if (!models.status(spec).let { it == ai.storyteller.photocraft.ai.ModelStatus.VALID } &&
            isMetered(androidContext) && !context.settings().current().downloadOnMeteredNetwork
        ) {
            context.showMessage(R.string.ai_download_metered)
            return
        }
        cancelled = false
        b.downloadProgress.visibility = View.VISIBLE
        b.cancelButton.visibility = View.VISIBLE
        b.downloadModel.isEnabled = false
        downloadJob?.cancel()
        downloadJob = context.scope().launch {
            val ok = models.ensure(
                spec = spec,
                isCancelled = { cancelled },
                onProgress = { progress ->
                    val percent = if (progress.totalBytes > 0) {
                        (progress.receivedBytes * 100 / progress.totalBytes).toInt()
                    } else 0
                    b.downloadProgress.setProgressCompat(percent, true)
                    b.modelState.text = androidContext.getString(R.string.ai_downloading, percent)
                }
            )
            b.downloadProgress.visibility = View.GONE
            b.cancelButton.visibility = View.GONE
            if (ok) {
                context.showMessage(R.string.ai_download_done)
            } else if (!cancelled) {
                context.showMessage(R.string.ai_download_failed, spec.label)
            }
            refreshModelState()
        }
    }

    private fun cancel() {
        cancelled = true
        downloadJob?.cancel()
        removalJob?.cancel()
        binding?.downloadProgress?.visibility = View.GONE
        binding?.cancelButton?.visibility = View.GONE
        binding?.downloadModel?.isEnabled = true
        context.showMessage(R.string.ai_cancelled)
    }

    /**
     * Runs the ONNX model on the **current composite** at the document's own pixel size and applies
     * the resulting mask to the active layer.
     */
    private fun highQualityRemove() {
        val b = binding ?: return
        val models = context.app().models
        val spec = selectedSpec() ?: return
        if (models.status(spec) != ai.storyteller.photocraft.ai.ModelStatus.VALID) {
            context.showMessage(R.string.ai_model_state_missing)
            downloadSelected()
            return
        }
        val engine = context.engine() ?: return
        val document = info ?: context.documentInfo() ?: return
        val layer = activeLayer(document)
        if (layer == null) {
            context.showMessage(R.string.ai_no_subject)
            return
        }
        cancelled = false
        b.cancelButton.visibility = View.VISIBLE
        b.statusLine.text = b.root.context.getString(R.string.ai_working)
        removalJob?.cancel()
        removalJob = context.scope().launch {
            val result = runCatching {
                onEngine {
                    // The composite at the document's real size: the mask must line up with the
                    // layer's pixels, so no downscaled preview is used for the result.
                    val bitmap = engine.render(document.width.coerceAtMost(document.height).let {
                        maxOf(document.width, document.height).coerceIn(1, 2048)
                    })
                    val modelFile = models.fileFor(spec)
                    val removerInstance = remover ?: BackgroundRemover(b.root.context.applicationContext).also {
                        remover = it
                    }
                    removerInstance.load(spec, modelFile)
                    val removal = removerInstance.removeBackground(
                        bitmap = bitmap,
                        outWidth = document.width,
                        outHeight = document.height,
                        isCancelled = { cancelled }
                    )
                    bitmap.recycle()
                    if (removal == null) return@onEngine null
                    engine.applyAlphaMask(
                        layerId = layer.id,
                        mask = removal.mask.bytes,
                        width = removal.mask.width,
                        height = removal.mask.height,
                        label = spec.label
                    )
                    removal
                }
            }
            b.cancelButton.visibility = View.GONE
            result.onSuccess { removal ->
                if (removal == null) {
                    context.showMessage(R.string.ai_cancelled)
                } else {
                    b.statusLine.text = b.root.context.getString(
                        R.string.ai_inference_time,
                        removal.inferenceMs,
                        removal.totalMs
                    )
                    context.showMessage(R.string.ai_applied)
                    context.refresh()
                }
            }.onFailure { error ->
                val message = (error as? RemovalException)?.message ?: error.message ?: ""
                context.showMessage(R.string.ai_failed, message)
                b.statusLine.text = message
            }
        }
    }

    override fun refresh(info: DocumentInfo?) {
        this.info = info
        refreshModelState()
    }

    override fun onDetached() {
        cancelled = true
        downloadJob?.cancel()
        removalJob?.cancel()
        remover?.close()
        remover = null
        binding = null
    }

    private fun isMetered(context: Context): Boolean {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }
}
