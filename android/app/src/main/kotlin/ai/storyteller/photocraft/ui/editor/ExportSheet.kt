package ai.storyteller.photocraft.ui.editor

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import kotlinx.coroutines.launch
import org.json.JSONObject
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.core.onEngine
import ai.storyteller.photocraft.data.ExportFormat
import ai.storyteller.photocraft.databinding.ViewSheetExportBinding

/**
 * Export.
 *
 * Three rules this sheet never breaks:
 *
 *  1. **A scaled export never touches the open document.** A scale under 100 % goes to
 *     [ai.storyteller.photocraft.core.Engine.exportScaled], which duplicates the document into a
 *     throwaway session before resizing it; the user's project keeps its original pixels.
 *  2. **A format that cannot store layers is labelled as such.** Only PSD and `.pcraft` are
 *     re-openable as layers, and the sheet says the flat ones are not.
 *  3. **An empty result is an error, never a "success".** A zero-byte or missing file is reported.
 */
class ExportSheet : BottomSheetDialogFragment() {

    private var _binding: ViewSheetExportBinding? = null
    private val binding get() = _binding!!

    private var docWidth: Int = 1080
    private var docHeight: Int = 1080

    /** Opens the system file picker when the user wants to choose the destination folder. */
    private val pickFolder = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        if (uri != null) exportToTree(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        docWidth = requireArguments().getInt(ARG_WIDTH, 1080)
        docHeight = requireArguments().getInt(ARG_HEIGHT, 1080)
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = ViewSheetExportBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val editor = (activity as? EditorActivity)
        val settings = editor?.settings()?.current()

        fun updateSize() {
            val scale = binding.scaleSlider.value / 100.0
            val width = (docWidth * scale).toInt().coerceAtLeast(1)
            val height = (docHeight * scale).toInt().coerceAtLeast(1)
            binding.scaleLabel.text = if (scale >= 0.999) {
                getString(R.string.export_scale_full, width, height)
            } else {
                getString(R.string.export_scale_percent, (scale * 100).toInt(), width, height)
            }
            binding.outputSize.text = getString(R.string.export_scale_full, width, height)
        }

        fun updateTransparency() {
            val supportsAlpha = selectedFormat().supportsAlpha
            binding.transparencySwitch.isEnabled = supportsAlpha
            binding.transparencySwitch.isChecked = supportsAlpha && binding.transparencySwitch.isChecked
            binding.transparencyNote.visibility =
                if (!supportsAlpha) View.VISIBLE else View.GONE
            binding.qualitySlider.isEnabled = selectedFormat() != ExportFormat.PNG
        }

        binding.scaleSlider.addOnChangeListener { _, _, _ -> updateSize() }
        binding.formatGroup.setOnCheckedChangeListener { _, _ -> updateTransparency() }
        binding.transparencySwitch.setOnCheckedChangeListener { _, _ -> updateSize() }

        settings?.let {
            binding.scaleSlider.value = it.exportScalePercent.toFloat().coerceIn(10f, 100f)
            binding.qualitySlider.value = it.jpegQuality.toFloat()
            binding.transparencySwitch.isChecked = it.preserveTransparency
            when (it.exportFormat) {
                ExportFormat.PNG -> binding.formatPng.isChecked = true
                ExportFormat.JPEG -> binding.formatJpeg.isChecked = true
                ExportFormat.WEBP -> binding.formatWebp.isChecked = true
            }
        }

        updateSize()
        updateTransparency()

        binding.exportButton.setOnClickListener { export(share = false) }
        binding.shareButton.setOnClickListener { export(share = true) }
    }

    private fun selectedFormat(): ExportFormat = when {
        binding.formatJpeg.isChecked -> ExportFormat.JPEG
        binding.formatWebp.isChecked -> ExportFormat.WEBP
        else -> ExportFormat.PNG
    }

    /** The engine's target: an extension for the flat formats, `.psd` or `.pcraft`. */
    private fun targetName(): String = when {
        binding.formatPcraft.isChecked -> "project.pcraft"
        binding.formatPsd.isChecked -> "project.psd"
        else -> "export.${selectedFormat().extension}"
    }

    private fun options(): JSONObject {
        val format = selectedFormat()
        return JSONObject()
            .put("jpegQuality", binding.qualitySlider.value.toInt())
            .put("webpQuality", binding.qualitySlider.value.toInt())
            .put("webpLossless", false)
            .put("preserveTransparency", binding.transparencySwitch.isChecked)
            .put("flatten", true)
            .put("format", format.extension)
    }

    private fun export(share: Boolean) {
        val editor = activity as? EditorActivity ?: return
        val engine = editor.engine() ?: return
        val scale = binding.scaleSlider.value / 100.0
        val name = targetName()
        binding.exportButton.isEnabled = false
        binding.status?.text = getString(R.string.export_working)

        editor.scope().launch {
            val result = runCatching {
                onEngine {
                    val bytes = if (scale >= 0.999) {
                        engine.export(name, options())
                    } else {
                        engine.exportScaled(
                            nameOrExt = name,
                            width = (docWidth * scale).toInt().coerceAtLeast(1),
                            height = (docHeight * scale).toInt().coerceAtLeast(1),
                            options = options()
                        )
                    }
                    bytes
                }
            }
            binding.exportButton.isEnabled = true
            result.onSuccess { bytes ->
                if (bytes.isEmpty()) {
                    editor.showMessage(R.string.export_empty)
                    return@onSuccess
                }
                val uri = saveToGallery(bytes, name)
                if (uri == null) {
                    editor.showMessage(R.string.export_failed, "the file could not be written")
                    return@onSuccess
                }
                if (share) {
                    val intent = Intent(Intent.ACTION_SEND)
                        .setType(mimeFor(name))
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    startActivity(Intent.createChooser(intent, getString(R.string.export_share)))
                } else {
                    editor.showMessage(R.string.export_saved, name)
                }
                dismiss()
            }.onFailure { error ->
                editor.showMessage(R.string.export_failed, error.message ?: "")
            }
        }
    }

    /** Exports into a folder the user chose with the SAF picker. */
    private fun exportToTree(tree: android.net.Uri) {
        val editor = activity as? EditorActivity ?: return
        val engine = editor.engine() ?: return
        val name = targetName()
        editor.scope().launch {
            val result = runCatching {
                onEngine { engine.export(name, options()) }
            }
            result.onSuccess { bytes ->
                val resolver = requireContext().contentResolver
                val child = android.provider.DocumentsContract.buildDocumentUriUsingTree(
                    tree,
                    android.provider.DocumentsContract.getTreeDocumentId(tree)
                )
                val created = android.provider.DocumentsContract.createDocument(
                    resolver, child, mimeFor(name), name
                )
                if (created == null) {
                    editor.showMessage(R.string.export_failed, "the folder refused the file")
                    return@onSuccess
                }
                resolver.openOutputStream(created)?.use { it.write(bytes) }
                    ?: run { editor.showMessage(R.string.export_failed, "the file could not be written"); return@onSuccess }
                editor.showMessage(R.string.export_saved, name)
                dismiss()
            }.onFailure { error ->
                editor.showMessage(R.string.export_failed, error.message ?: "")
            }
        }
    }

    /** Saves into Pictures/PhotoCraft on Q+, or the app's public Pictures folder below that. */
    private fun saveToGallery(bytes: ByteArray, name: String): android.net.Uri? {
        val context = requireContext()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeFor(name))
                put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/PhotoCraft")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values
            ) ?: return null
            context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            context.contentResolver.update(uri, values, null, null)
            uri
        } else {
            val dir = java.io.File(
                android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_PICTURES
                ),
                "PhotoCraft"
            ).apply { mkdirs() }
            val file = java.io.File(dir, name)
            file.writeBytes(bytes)
            FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        }
    }

    private fun mimeFor(name: String): String = when (name.substringAfterLast('.').lowercase()) {
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "psd" -> "image/vnd.adobe.photoshop"
        "pcraft" -> "application/octet-stream"
        else -> "image/png"
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "ExportSheet"
        private const val ARG_WIDTH = "width"
        private const val ARG_HEIGHT = "height"

        fun newInstance(width: Int, height: Int, defaultFormat: ExportFormat): ExportSheet =
            ExportSheet().apply {
                arguments = Bundle().apply {
                    putInt(ARG_WIDTH, width)
                    putInt(ARG_HEIGHT, height)
                    putString("format", defaultFormat.extension)
                }
            }
    }
}
