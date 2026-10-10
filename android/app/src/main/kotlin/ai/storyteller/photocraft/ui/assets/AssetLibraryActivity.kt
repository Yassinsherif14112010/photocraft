package ai.storyteller.photocraft.ui.assets

import android.graphics.BitmapFactory
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch
import androidx.lifecycle.lifecycleScope
import ai.storyteller.photocraft.PhotocraftApp
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.data.Asset
import ai.storyteller.photocraft.databinding.ActivityAssetsBinding
import ai.storyteller.photocraft.databinding.ItemAssetBinding
import ai.storyteller.photocraft.ui.common.formatBytes
import ai.storyteller.photocraft.ui.common.gridSpan
import ai.storyteller.photocraft.ui.common.snack
import ai.storyteller.photocraft.ui.common.windowSizeClass
import ai.storyteller.photocraft.util.readPickedFile

/**
 * The asset library: logos, textures and photos reused across projects.
 *
 * An import copies the bytes into the app's private storage, keeps the original file name and
 * records the real dimensions the importer reported — no re-encode, no downscaling, no "asset" that
 * is only a thumbnail.
 */
class AssetLibraryActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAssetsBinding
    private lateinit var app: PhotocraftApp
    private lateinit var adapter: AssetAdapter

    private val pickFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            val (picked, error) = readPickedFile(uri)
            if (picked == null) {
                binding.root.snack(error ?: getString(R.string.import_unsupported))
                return@launch
            }
            val asset = app.assets.import(picked.name, picked.bytes, picked.mime)
            if (asset == null) {
                binding.root.snack(getString(R.string.import_unsupported))
            } else {
                binding.root.snack(getString(R.string.assets_added))
                refresh()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAssetsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        app = PhotocraftApp.of(this)

        binding.toolbar.setNavigationOnClickListener { finish() }
        binding.fabAdd.setOnClickListener { pickFile.launch(arrayOf("image/*", "application/octet-stream")) }

        binding.recycler.layoutManager = GridLayoutManager(this, gridSpan(this, windowSizeClass(), assetGrid = true))
        adapter = AssetAdapter(
            onOpen = { /* assets are placed from the editor */ },
            onDelete = { confirmDelete(it) }
        )
        binding.recycler.adapter = adapter
        refresh()
    }

    private fun refresh() {
        lifecycleScope.launch {
            val list = app.assets.all()
            adapter.submitList(list)
            binding.empty.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
        }
    }

    private fun confirmDelete(asset: Asset) {
        MaterialAlertDialogBuilder(this)
            .setMessage(getString(R.string.brand_delete_logo, asset.name))
            .setNegativeButton(R.string.common_cancel, null)
            .setPositiveButton(R.string.common_delete) { _, _ ->
                lifecycleScope.launch {
                    app.assets.delete(asset.id)
                    binding.root.snack(getString(R.string.assets_deleted))
                    refresh()
                }
            }
            .show()
    }

    private inner class AssetAdapter(
        private val onOpen: (Asset) -> Unit,
        private val onDelete: (Asset) -> Unit
    ) : ListAdapter<Asset, AssetAdapter.Holder>(Diff) {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder =
            Holder(ItemAssetBinding.inflate(LayoutInflater.from(parent.context), parent, false))

        override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(getItem(position))

        inner class Holder(private val binding: ItemAssetBinding) : RecyclerView.ViewHolder(binding.root) {

            fun bind(asset: Asset) {
                binding.name.text = asset.name
                binding.meta.text = getString(
                    R.string.assets_size,
                    asset.width,
                    asset.height,
                    formatBytes(asset.bytes)
                )
                asset.thumbnailPath?.takeIf { java.io.File(it).isFile }?.let {
                    binding.thumb.setImageBitmap(BitmapFactory.decodeFile(it))
                } ?: binding.thumb.setImageResource(R.drawable.ic_image)
                binding.root.setOnClickListener { onOpen(asset) }
                binding.root.setOnLongClickListener { onDelete(asset); true }
            }
        }

        private val Diff = object : DiffUtil.ItemCallback<Asset>() {
            override fun areItemsTheSame(a: Asset, b: Asset): Boolean = a.id == b.id
            override fun areContentsTheSame(a: Asset, b: Asset): Boolean = a == b
        }
    }
}
