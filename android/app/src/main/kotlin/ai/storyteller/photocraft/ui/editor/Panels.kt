package ai.storyteller.photocraft.ui.editor

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch
import org.json.JSONObject
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.core.DocumentInfo
import ai.storyteller.photocraft.core.LayerInfo
import ai.storyteller.photocraft.data.Asset
import ai.storyteller.photocraft.databinding.ItemLayerBinding
import ai.storyteller.photocraft.databinding.ViewPanelAdjustBinding
import ai.storyteller.photocraft.databinding.ViewPanelLayersBinding
import ai.storyteller.photocraft.databinding.ViewPanelTextBinding
import ai.storyteller.photocraft.databinding.ViewPanelTransformBinding
import ai.storyteller.photocraft.ui.common.formatBytes

/**
 * The editor's panels.
 *
 * Every button here maps to one real engine command id (the ids are the engine's own, from
 * `crates/engine/src/commands.rs`): a panel never mutates pixels itself and never keeps a private
 * copy of the document — it reads [DocumentInfo] and asks [EditorContext.runCommand] for changes.
 */
abstract class BasePanel : EditorPanel {

    protected lateinit var context: EditorContext
    protected var host: EditorPanelHost? = null
    private var view: View? = null

    override fun createView(context: EditorContext, parent: EditorPanelHost): View {
        this.context = context
        this.host = parent
        val inflater = LayoutInflater.from((context as? android.content.Context)
            ?: throw IllegalStateException("panels need an Android context"))
        val created = inflate(inflater)
        view = created
        onViewCreated(created)
        return created
    }

    protected abstract fun inflate(inflater: LayoutInflater): View

    protected open fun onViewCreated(view: View) = Unit

    protected fun activeLayer(info: DocumentInfo?): LayerInfo? =
        (info ?: context.documentInfo())?.let { it.layer(it.activeLayer) ?: it.layers.lastOrNull() }

    protected fun run(command: String, params: JSONObject = JSONObject()) =
        context.runCommand(command, params)

    protected fun paramsFor(layer: LayerInfo?): JSONObject {
        val params = JSONObject()
        layer?.let { params.put("layer", it.id) }
        return params
    }
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

/** The layers panel: order, visibility, opacity, groups, merge, duplicate, delete. */
class LayersPanel : BasePanel() {

    override val id: String = "layers"

    private var binding: ViewPanelLayersBinding? = null
    private var adapter: LayerAdapter? = null
    private var info: DocumentInfo? = null

    override fun inflate(inflater: LayoutInflater): View =
        ViewPanelLayersBinding.inflate(inflater).also { binding = it }.root

    override fun onViewCreated(view: View) {
        val b = binding ?: return
        adapter = LayerAdapter(
            onSelect = { layer -> run("layer.select", paramsFor(layer)) },
            onToggleVisibility = { layer ->
                run(if (layer.visible) "layer.hideLayers" else "layer.showLayers", paramsFor(layer))
            },
            onRename = { layer -> askName(layer) }
        )
        b.layerList.layoutManager = LinearLayoutManager(view.context)
        b.layerList.adapter = adapter
        b.addLayer.setOnClickListener { run("layer.new.layer") }
        b.up.setOnClickListener { run("layer.arrange.bringForward", paramsFor(activeLayer(info))) }
        b.down.setOnClickListener { run("layer.arrange.sendBackward", paramsFor(activeLayer(info))) }
        b.duplicate.setOnClickListener { run("layer.duplicate", paramsFor(activeLayer(info))) }
        b.rename.setOnClickListener { activeLayer(info)?.let { askName(it) } }
        b.delete.setOnClickListener { run("layer.delete", paramsFor(activeLayer(info))) }
        b.group.setOnClickListener { run("layer.groupLayers") }
        b.ungroup.setOnClickListener { run("layer.ungroup", paramsFor(activeLayer(info))) }
        b.mergeVisible.setOnClickListener { run("layer.mergeVisible") }

        b.opacity.valueFrom = 0f
        b.opacity.valueTo = 100f
        b.opacity.stepSize = 1f
        b.opacity.addOnChangeListener { _, value, fromUser ->
            if (!fromUser) return@addOnChangeListener
            b.opacityLabel.text = view.context.getString(R.string.layers_opacity, value.toInt())
        }
        b.opacity.addOnSliderTouchListener(object : com.google.android.material.slider.Slider.OnSliderTouchListener {
            override fun onStartTrackingTouch(slider: com.google.android.material.slider.Slider) = Unit
            override fun onStopTrackingTouch(slider: com.google.android.material.slider.Slider) {
                val layer = activeLayer(info) ?: return
                val params = paramsFor(layer).put("opacity", slider.value / 100.0)
                run("layer.setProps", params)
            }
        })
    }

    private fun askName(layer: LayerInfo) {
        val activity = view?.context ?: return
        val input = TextInputEditText(activity).apply { setText(layer.name) }
        MaterialAlertDialogBuilder(activity)
            .setTitle(R.string.layers_rename)
            .setView(input)
            .setNegativeButton(R.string.common_cancel, null)
            .setPositiveButton(R.string.common_save) { _, _ ->
                val name = input.text?.toString()?.trim().orEmpty()
                if (name.isNotEmpty()) {
                    run("layer.setProps", paramsFor(layer).put("name", name))
                }
            }
            .show()
    }

    override fun refresh(info: DocumentInfo?) {
        this.info = info
        val b = binding ?: return
        adapter?.submitList(info?.layers?.reversed() ?: emptyList())
        b.empty.visibility = if (info == null || info.layers.isEmpty()) View.VISIBLE else View.GONE
        val layer = activeLayer(info)
        b.opacity.value = (layer?.opacity ?: 1f) * 100f
        b.opacityLabel.text = b.root.context.getString(
            R.string.layers_opacity,
            ((layer?.opacity ?: 1f) * 100f).toInt()
        )
    }

    override fun onDetached() {
        binding = null
        adapter = null
    }
}

private class LayerAdapter(
    private val onSelect: (LayerInfo) -> Unit,
    private val onToggleVisibility: (LayerInfo) -> Unit,
    private val onRename: (LayerInfo) -> Unit
) : ListAdapter<LayerInfo, LayerAdapter.Holder>(Diff) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder =
        Holder(ItemLayerBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(getItem(position))

    inner class Holder(private val binding: ItemLayerBinding) : RecyclerView.ViewHolder(binding.root) {

        fun bind(layer: LayerInfo) {
            val res = binding.root.resources
            binding.name.text = layer.name
            binding.details.text = buildString {
                append(if (layer.kind.isBlank()) "layer" else layer.kind)
                append(" · ")
                append("${(layer.opacity * 100).toInt()}%")
                if (layer.blend.isNotBlank() && !layer.blend.equals("Normal", ignoreCase = true)) append(" · ${layer.blend}")
            }
            binding.visibility.setImageResource(
                if (layer.visible) R.drawable.ic_eye else R.drawable.ic_eye_off
            )
            binding.visibility.contentDescription =
                res.getString(if (layer.visible) R.string.layers_hide else R.string.layers_show)
            binding.maskBadge.visibility = if (layer.hasMask) View.VISIBLE else View.GONE
            binding.row.isSelected = binding.root.isSelected

            binding.root.setOnClickListener { onSelect(layer) }
            binding.visibility.setOnClickListener { onToggleVisibility(layer) }
            binding.name.setOnLongClickListener { onRename(layer); true }
        }
    }

    private object Diff : DiffUtil.ItemCallback<LayerInfo>() {
        override fun areItemsTheSame(a: LayerInfo, b: LayerInfo): Boolean = a.id == b.id
        override fun areContentsTheSame(a: LayerInfo, b: LayerInfo): Boolean = a == b
    }
}

// ---------------------------------------------------------------------------
// Text studio
// ---------------------------------------------------------------------------

/**
 * Text Studio.
 *
 * `type.create` makes a real text layer with a real character style (`font`, `weight`, `size`,
 * `tracking`, `leading`, `color`, `align`); `type.edit` changes an existing one. Nothing is drawn
 * into the bitmap, so text stays editable, re-flowable and non-destructive.
 */
class TextPanel : BasePanel() {

    override val id: String = "text"

    private var binding: ViewPanelTextBinding? = null
    private var info: DocumentInfo? = null
    private var fonts: List<String> = listOf("Inter", "Roboto", "Noto Sans", "serif", "sans-serif", "monospace")

    override fun inflate(inflater: LayoutInflater): View =
        ViewPanelTextBinding.inflate(inflater).also { binding = it }.root

    override fun onViewCreated(view: View) {
        val b = binding ?: return
        b.sizeSlider.valueFrom = 4f
        b.sizeSlider.valueTo = 240f
        b.sizeSlider.stepSize = 1f
        b.sizeSlider.value = 48f
        b.trackingSlider.valueFrom = -100f
        b.trackingSlider.valueTo = 400f
        b.trackingSlider.stepSize = 5f
        b.leadingSlider.valueFrom = 60f
        b.leadingSlider.valueTo = 240f
        b.leadingSlider.stepSize = 5f
        b.leadingSlider.value = 120f

        val updateLabels = {
            b.sizeLabel.text = view.context.getString(R.string.text_size, b.sizeSlider.value.toInt())
            b.trackingLabel.text = view.context.getString(R.string.text_tracking, b.trackingSlider.value.toInt())
            b.leadingLabel.text = view.context.getString(R.string.text_leading, b.leadingSlider.value.toInt())
        }
        val listener = com.google.android.material.slider.Slider.OnChangeListener { _, _, _ -> updateLabels() }
        b.sizeSlider.addOnChangeListener(listener)
        b.trackingSlider.addOnChangeListener(listener)
        b.leadingSlider.addOnChangeListener(listener)
        updateLabels()

        b.apply.setOnClickListener { applyText() }
        loadFonts()
    }

    /** The engine knows the fonts it really has: `type.fonts` is the source of truth. */
    private fun loadFonts() {
        context.scope().launch {
            val engine = context.engine() ?: return@launch
            val result = runCatching {
                ai.storyteller.photocraft.core.onEngine {
                    val json = org.json.JSONObject(
                        (engine.execute("type.fonts") as? org.json.JSONObject)?.toString() ?: "{}"
                    )
                    json.optJSONArray("families")?.let { arr ->
                        (0 until arr.length()).map { arr.optString(it) }
                    } ?: emptyList()
                }
            }.getOrDefault(emptyList())
            if (result.isNotEmpty()) fonts = result
            val adapter = ArrayAdapter(
                binding?.root?.context ?: return@launch,
                android.R.layout.simple_spinner_dropdown_item,
                fonts
            )
            binding?.fontSpinner?.adapter = adapter
        }
    }

    private fun applyText() {
        val b = binding ?: return
        val text = b.textInput.text?.toString().orEmpty()
        if (text.isBlank()) {
            Toast.makeText(b.root.context, R.string.text_empty, Toast.LENGTH_SHORT).show()
            return
        }
        val infoNow = info ?: return
        val params = JSONObject()
            .put("text", text)
            .put("font", b.fontSpinner.selectedItem?.toString() ?: "Inter")
            .put("size", b.sizeSlider.value.toDouble())
            .put("weight", if (b.boldSwitch.isChecked) 700 else 400)
            .put("tracking", b.trackingSlider.value.toInt())
            .put("leading", b.leadingSlider.value.toDouble())
            .put("align", when {
                b.alignCenter.isChecked -> "center"
                b.alignEnd.isChecked -> "right"
                else -> "left"
            })
            .put("color", "#FFFFFF")
            .put("orientation", if (b.rtlSwitch.isChecked) "rtl" else "horizontal")
            .put("name", text.take(24))
            .put("x", infoNow.width / 2.0)
            .put("y", infoNow.height / 2.0)
        run("type.create", params)
    }

    override fun refresh(info: DocumentInfo?) {
        this.info = info
    }

    override fun onDetached() {
        binding = null
    }
}

// ---------------------------------------------------------------------------
// Adjust
// ---------------------------------------------------------------------------

/**
 * Colour adjustments.
 *
 * Each control maps to one of the engine's adjustment commands (`image.adjustments.*`), which are
 * real pixel edits at the document's real bit depth with a single undo step per apply.
 */
class AdjustPanel : BasePanel() {

    override val id: String = "adjust"

    private var binding: ViewPanelAdjustBinding? = null

    override fun inflate(inflater: LayoutInflater): View =
        ViewPanelAdjustBinding.inflate(inflater).also { binding = it }.root

    override fun onViewCreated(view: View) {
        val b = binding ?: return
        b.hueSlider.valueFrom = -180f
        b.hueSlider.valueTo = 180f
        b.hueSlider.stepSize = 1f
        b.saturationSlider.valueFrom = -100f
        b.saturationSlider.valueTo = 100f
        b.saturationSlider.stepSize = 1f
        b.lightnessSlider.valueFrom = -100f
        b.lightnessSlider.valueTo = 100f
        b.lightnessSlider.stepSize = 1f

        val labels = {
            b.hueLabel.text = view.context.getString(R.string.adjust_hue, b.hueSlider.value.toInt())
            b.saturationLabel.text = view.context.getString(R.string.adjust_saturation, b.saturationSlider.value.toInt())
            b.lightnessLabel.text = view.context.getString(R.string.adjust_lightness, b.lightnessSlider.value.toInt())
        }
        val listener = com.google.android.material.slider.Slider.OnChangeListener { _, _, _ -> labels() }
        b.hueSlider.addOnChangeListener(listener)
        b.saturationSlider.addOnChangeListener(listener)
        b.lightnessSlider.addOnChangeListener(listener)
        labels()

        b.applyHue.setOnClickListener {
            run(
                "image.adjustments.hueSaturation",
                JSONObject()
                    .put("hue", b.hueSlider.value.toDouble())
                    .put("saturation", b.saturationSlider.value.toDouble())
                    .put("lightness", b.lightnessSlider.value.toDouble())
            )
        }
        b.invert.setOnClickListener { run("image.adjustments.invert") }
        b.blackWhite.setOnClickListener { run("image.adjustments.blackWhite") }
        b.autoTone.setOnClickListener { run("image.autoTone") }
        b.autoContrast.setOnClickListener { run("image.autoContrast") }
    }

    override fun refresh(info: DocumentInfo?) = Unit

    override fun onDetached() {
        binding = null
    }
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/**
 * Canvas and layer transforms.
 *
 * Rotation and flipping use the canvas-rotation commands (they affect the whole document, like
 * Image › Image Rotation); scaling is a real `image.imageSize` resample of the project, and the
 * panel says so before the user commits.
 */
class TransformPanel : BasePanel() {

    override val id: String = "transform"

    private var binding: ViewPanelTransformBinding? = null
    private var info: DocumentInfo? = null

    override fun inflate(inflater: LayoutInflater): View =
        ViewPanelTransformBinding.inflate(inflater).also { binding = it }.root

    override fun onViewCreated(view: View) {
        val b = binding ?: return
        b.rotateLeft.setOnClickListener { run("image.imageRotation.90ccw") }
        b.rotateRight.setOnClickListener { run("image.imageRotation.90cw") }
        b.flipH.setOnClickListener { run("image.imageRotation.flipCanvasHorizontal") }
        b.flipV.setOnClickListener { run("image.imageRotation.flipCanvasVertical") }

        b.scaleSlider.valueFrom = 10f
        b.scaleSlider.valueTo = 400f
        b.scaleSlider.stepSize = 5f
        b.scaleSlider.value = 100f
        b.scaleSlider.addOnChangeListener { _, value, _ ->
            val infoNow = info ?: return@addOnChangeListener
            b.scaleLabel.text = view.context.getString(
                R.string.transform_scale,
                value.toInt(),
                (infoNow.width * value / 100f).toInt(),
                (infoNow.height * value / 100f).toInt()
            )
        }
        b.applyScale.setOnClickListener {
            val infoNow = info ?: return@setOnClickListener
            val factor = b.scaleSlider.value / 100.0
            run(
                "image.imageSize",
                JSONObject()
                    .put("width", (infoNow.width * factor).toInt().coerceAtLeast(1))
                    .put("height", (infoNow.height * factor).toInt().coerceAtLeast(1))
                    .put("resample", "bicubic")
            )
        }
        b.cropToSelection.setOnClickListener { run("image.crop", JSONObject().put("trim", true)) }
        b.fit.setOnClickListener { run("view.fitOnScreen") }
        b.actualSize.setOnClickListener { run("view.actualPixels") }
    }

    override fun refresh(info: DocumentInfo?) {
        this.info = info
        val b = binding ?: return
        info?.let { current ->
            b.scaleLabel.text = b.root.context.getString(
                R.string.transform_scale,
                b.scaleSlider.value.toInt(),
                (current.width * b.scaleSlider.value / 100f).toInt(),
                (current.height * b.scaleSlider.value / 100f).toInt()
            )
        }
    }

    override fun onDetached() {
        binding = null
    }
}

// ---------------------------------------------------------------------------
// Assets (brand kit + library inside the editor)
// ---------------------------------------------------------------------------

/**
 * Places an asset into the document.
 *
 * The asset's file is copied into the project's private storage and placed with
 * `file.placeEmbedded`, which reads and imports it through the engine's importer.
 */
class AssetsPanel(
    private val onPickFromDevice: () -> Unit
) : BasePanel() {

    override val id: String = "assets"

    private var root: View? = null
    private var info: DocumentInfo? = null

    override fun inflate(inflater: LayoutInflater): View {
        val context = this.context as android.content.Context
        val layout = android.widget.LinearLayout(context).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, pad)
            setBackgroundColor(context.getColor(R.color.pc_surface_panel))
        }
        val title = android.widget.TextView(context).apply {
            setText(R.string.assets_title)
            setTextAppearance(R.style.TextAppearance_PhotoCraft_Title)
        }
        layout.addView(title)
        val button = com.google.android.material.button.MaterialButton(context).apply {
            setText(R.string.assets_place)
            setIconResource(R.drawable.ic_add)
            setOnClickListener { onPickFromDevice() }
        }
        layout.addView(button)
        val hint = android.widget.TextView(context).apply {
            setText(R.string.assets_hint)
            setTextAppearance(R.style.TextAppearance_PhotoCraft_Caption)
        }
        layout.addView(hint)
        root = layout
        return layout
    }

    override fun refresh(info: DocumentInfo?) {
        this.info = info
    }

    override fun onDetached() {
        root = null
    }
}

/** Human-readable asset size, shared by the panels that list assets. */
internal fun assetSummary(item: Asset): String = formatBytes(item.bytes)
