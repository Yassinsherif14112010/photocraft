package ai.storyteller.photocraft.ui.templates

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.data.DocumentPreset
import ai.storyteller.photocraft.databinding.ItemPresetBinding

/**
 * The preset list.
 *
 * Each row draws the preset's real aspect ratio (a portrait story is tall, a YouTube thumbnail is
 * wide), so the shape of the document is obvious before the user taps it.
 */
class PresetAdapter(
    private val onPick: (DocumentPreset) -> Unit
) : ListAdapter<DocumentPreset, PresetAdapter.Holder>(Diff) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val binding = ItemPresetBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return Holder(binding)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(getItem(position))

    inner class Holder(private val binding: ItemPresetBinding) : RecyclerView.ViewHolder(binding.root) {

        fun bind(preset: DocumentPreset) {
            val context = binding.root.context
            binding.name.text = runCatching {
                val id = context.resources.getIdentifier(preset.nameRes, "string", context.packageName)
                if (id != 0) context.getString(id) else preset.id
            }.getOrDefault(preset.id)
            binding.size.text = context.getString(R.string.home_project_size, preset.width, preset.height)

            // Draw the aspect ratio: longest side 36 dp, shortest side scaled to match.
            val maxSide = 36
            val (w, h) = if (preset.aspect >= 1f) {
                maxSide to (maxSide / preset.aspect).toInt().coerceAtLeast(10)
            } else {
                (maxSide * preset.aspect).toInt().coerceAtLeast(10) to maxSide
            }
            val density = context.resources.displayMetrics.density
            binding.shape.layoutParams = binding.shape.layoutParams.apply {
                width = (w * density).toInt()
                height = (h * density).toInt()
            }
            binding.root.setOnClickListener { onPick(preset) }
        }
    }

    private object Diff : DiffUtil.ItemCallback<DocumentPreset>() {
        override fun areItemsTheSame(a: DocumentPreset, b: DocumentPreset): Boolean = a.id == b.id
        override fun areContentsTheSame(a: DocumentPreset, b: DocumentPreset): Boolean = a == b
    }
}
