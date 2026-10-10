package ai.storyteller.photocraft.ui.templates

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.GridLayoutManager
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.data.DocumentPreset
import ai.storyteller.photocraft.databinding.ViewSheetNewProjectBinding
import ai.storyteller.photocraft.ui.common.gridSpan
import ai.storyteller.photocraft.ui.common.windowSizeClass

/**
 * New project: a social-media or print preset, or a custom size.
 *
 * Whatever the user picks, the sheet returns a real [DocumentPreset]-derived size and background
 * and the caller asks the engine to create the document — no mock or preview document is made
 * here.
 */
class NewProjectSheet : BottomSheetDialogFragment() {

    /** The result: a preset with the chosen background applied. */
    data class Request(
        val width: Int,
        val height: Int,
        val background: DocumentPreset.Background,
        val name: String,
        val presetId: String?
    )

    private var _binding: ViewSheetNewProjectBinding? = null
    private val binding get() = _binding!!

    var onCreated: ((Request) -> Unit)? = null

    private var group: DocumentPreset.Group = DocumentPreset.Group.SOCIAL
    private var background: DocumentPreset.Background = DocumentPreset.Background.WHITE
    private var customMode = false

    private val adapter = PresetAdapter { preset ->
        onCreated?.invoke(
            Request(
                width = preset.width,
                height = preset.height,
                background = background,
                name = presetName(preset),
                presetId = preset.id
            )
        )
        dismiss()
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = ViewSheetNewProjectBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val sizeClass = requireActivity().windowSizeClass()
        binding.presets.layoutManager = GridLayoutManager(requireContext(), gridSpan(requireContext(), sizeClass))
        binding.presets.adapter = adapter
        adapter.submitList(DocumentPreset.ALL.filter { it.group == group })

        binding.tabs.addOnTabSelectedListener(object : com.google.android.material.tabs.TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: com.google.android.material.tabs.TabLayout.Tab) {
                when (tab.position) {
                    0 -> selectGroup(DocumentPreset.Group.SOCIAL)
                    1 -> selectGroup(DocumentPreset.Group.PRINT)
                    2 -> selectGroup(DocumentPreset.Group.BLANK)
                    else -> selectCustom()
                }
            }

            override fun onTabUnselected(tab: com.google.android.material.tabs.TabLayout.Tab) = Unit
            override fun onTabReselected(tab: com.google.android.material.tabs.TabLayout.Tab) = Unit
        })

        binding.backgroundGroup.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            background = when (checkedId) {
                R.id.bgBlack -> DocumentPreset.Background.BLACK
                R.id.bgTransparent -> DocumentPreset.Background.TRANSPARENT
                else -> DocumentPreset.Background.WHITE
            }
        }
        binding.backgroundGroup.check(R.id.bgWhite)

        binding.create.setOnClickListener { createCustom() }
    }

    private fun selectGroup(next: DocumentPreset.Group) {
        group = next
        customMode = false
        binding.customGroup.visibility = View.GONE
        binding.presets.visibility = View.VISIBLE
        adapter.submitList(DocumentPreset.ALL.filter { it.group == group })
    }

    private fun selectCustom() {
        customMode = true
        binding.presets.visibility = View.GONE
        binding.customGroup.visibility = View.VISIBLE
    }

    private fun createCustom() {
        if (!customMode) {
            // A preset tab is showing: create the first preset of that group.
            DocumentPreset.ALL.firstOrNull { it.group == group }?.let { preset ->
                onCreated?.invoke(
                    Request(preset.width, preset.height, background, presetName(preset), preset.id)
                )
                dismiss()
            }
            return
        }
        val width = binding.widthInput.text?.toString()?.toIntOrNull() ?: 0
        val height = binding.heightInput.text?.toString()?.toIntOrNull() ?: 0
        if (width !in 1..30_000 || height !in 1..30_000) {
            binding.widthInput.error = getString(R.string.newproject_invalid_size)
            return
        }
        onCreated?.invoke(Request(width, height, background, getString(R.string.newproject_custom), null))
        dismiss()
    }

    private fun presetName(preset: DocumentPreset): String {
        val id = resources.getIdentifier(preset.nameRes, "string", requireContext().packageName)
        return if (id != 0) getString(id) else preset.id
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val TAG = "NewProjectSheet"
    }
}
