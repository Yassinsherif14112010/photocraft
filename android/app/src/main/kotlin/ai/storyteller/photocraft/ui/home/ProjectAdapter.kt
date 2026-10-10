package ai.storyteller.photocraft.ui.home

import android.graphics.BitmapFactory
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.PopupMenu
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.data.Project
import ai.storyteller.photocraft.databinding.ItemProjectCardBinding
import ai.storyteller.photocraft.ui.common.formatPixels
import ai.storyteller.photocraft.ui.common.relativeTime

/** The recent-projects grid. Cards are responsive: the span count comes from the window size. */
class ProjectAdapter(
    private val onOpen: (Project) -> Unit,
    private val onAction: (Project, Action) -> Unit
) : ListAdapter<Project, ProjectAdapter.Holder>(Diff) {

    enum class Action { RENAME, DUPLICATE, EXPORT, DELETE }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val binding = ItemProjectCardBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return Holder(binding)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(getItem(position))

    inner class Holder(private val binding: ItemProjectCardBinding) : RecyclerView.ViewHolder(binding.root) {

        fun bind(project: Project) {
            val context = binding.root.context
            binding.root.contentDescription = context.getString(R.string.a11y_project_card)
            binding.name.text = project.name
            binding.meta.text = context.getString(
                R.string.home_project_size,
                project.width,
                project.height
            ) + " · " + context.relativeTime(project.updatedAt)

            val thumb = project.thumbnailPath
            if (thumb != null && java.io.File(thumb).isFile) {
                val bitmap = BitmapFactory.decodeFile(thumb)
                if (bitmap != null) binding.thumb.setImageBitmap(bitmap)
            } else {
                binding.thumb.setImageResource(R.drawable.ic_image)
                binding.thumb.imageTintList = null
            }

            binding.root.setOnClickListener { onOpen(project) }
            binding.overflow.setOnClickListener { showMenu(it, project) }
        }

        private fun showMenu(anchor: View, project: Project) {
            val menu = PopupMenu(anchor.context, anchor)
            menu.inflate(R.menu.menu_project_card)
            menu.setOnMenuItemClickListener {
                when (it.itemId) {
                    R.id.action_rename -> onAction(project, Action.RENAME)
                    R.id.action_duplicate -> onAction(project, Action.DUPLICATE)
                    R.id.action_export -> onAction(project, Action.EXPORT)
                    R.id.action_delete -> onAction(project, Action.DELETE)
                }
                true
            }
            menu.show()
        }
    }

    private object Diff : DiffUtil.ItemCallback<Project>() {
        override fun areItemsTheSame(a: Project, b: Project): Boolean = a.id == b.id
        override fun areContentsTheSame(a: Project, b: Project): Boolean = a == b
    }
}
