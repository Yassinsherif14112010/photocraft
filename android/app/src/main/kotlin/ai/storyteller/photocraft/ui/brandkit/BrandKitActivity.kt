package ai.storyteller.photocraft.ui.brandkit

import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.LinearLayoutCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.launch
import androidx.lifecycle.lifecycleScope
import ai.storyteller.photocraft.PhotocraftApp
import ai.storyteller.photocraft.R
import ai.storyteller.photocraft.data.BrandColor
import ai.storyteller.photocraft.data.BrandFont
import ai.storyteller.photocraft.data.BrandLogo
import ai.storyteller.photocraft.databinding.ActivityBrandkitBinding
import ai.storyteller.photocraft.databinding.ItemBrandColorBinding
import ai.storyteller.photocraft.ui.common.parseColorOr
import ai.storyteller.photocraft.ui.common.snack
import ai.storyteller.photocraft.util.readPickedFile

/**
 * Brand kit: colours, fonts and logos that any project can reuse.
 *
 * Everything is stored inside the app's private storage and re-read from disk, so a colour added
 * here is available the next time the app starts — and it is a real colour (`#rrggbb`), a real font
 * family name and a real logo file, not a preset list.
 */
class BrandKitActivity : AppCompatActivity() {

    private lateinit var binding: ActivityBrandkitBinding
    private lateinit var app: PhotocraftApp

    private val colorAdapter = ColorAdapter { confirmRemoveColor(it) }
    private val fontAdapter = FontAdapter { confirmRemoveFont(it) }
    private val logoAdapter = LogoAdapter { confirmRemoveLogo(it) }

    private val pickLogo = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@registerForActivityResult
        lifecycleScope.launch {
            val (picked, error) = readPickedFile(uri)
            if (picked == null) {
                binding.root.snack(error ?: getString(R.string.import_unsupported))
                return@launch
            }
            app.brandKit.addLogo(picked.name, picked.bytes)
            binding.root.snack(getString(R.string.assets_added))
            refresh()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityBrandkitBinding.inflate(layoutInflater)
        setContentView(binding.root)
        app = PhotocraftApp.of(this)

        binding.toolbar.setNavigationOnClickListener { finish() }

        binding.colors.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        binding.colors.adapter = colorAdapter
        binding.fonts.layoutManager = LinearLayoutManager(this)
        binding.fonts.adapter = fontAdapter
        binding.logos.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        binding.logos.adapter = logoAdapter

        binding.addColor.setOnClickListener { askColor() }
        binding.addFont.setOnClickListener { askFont() }
        binding.addLogo.setOnClickListener { pickLogo.launch(arrayOf("image/*")) }

        refresh()
    }

    private fun refresh() {
        lifecycleScope.launch {
            val kit = app.brandKit.load()
            colorAdapter.submitList(kit.colors)
            fontAdapter.submitList(kit.fonts)
            logoAdapter.submitList(kit.logos)
            binding.colorsEmpty.visibility = if (kit.colors.isEmpty()) View.VISIBLE else View.GONE
            binding.fontsEmpty.visibility = if (kit.fonts.isEmpty()) View.VISIBLE else View.GONE
            binding.logosEmpty.visibility = if (kit.logos.isEmpty()) View.VISIBLE else View.GONE
        }
    }

    private fun askColor() {
        val layout = LinearLayoutCompat(this).apply { orientation = LinearLayoutCompat.VERTICAL }
        val name = TextInputEditText(this).apply { hint = getString(R.string.brand_color_name) }
        val value = TextInputEditText(this).apply { setText("#1B5CF4") }
        layout.addView(name)
        layout.addView(value)
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.brand_add_color)
            .setView(layout)
            .setNegativeButton(R.string.common_cancel, null)
            .setPositiveButton(R.string.common_save) { _, _ ->
                val hex = value.text?.toString()?.trim().orEmpty()
                val parsed = parseColorOr(hex, Int.MIN_VALUE)
                if (parsed == Int.MIN_VALUE) {
                    binding.root.snack(getString(R.string.common_error, hex))
                    return@setPositiveButton
                }
                lifecycleScope.launch {
                    app.brandKit.addColor(BrandColor(name.text?.toString()?.trim().orEmpty(), hex))
                    refresh()
                }
            }
            .show()
    }

    private fun askFont() {
        val input = TextInputEditText(this).apply { setText("Inter") }
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.brand_add_font)
            .setView(input)
            .setNegativeButton(R.string.common_cancel, null)
            .setPositiveButton(R.string.common_save) { _, _ ->
                val family = input.text?.toString()?.trim().orEmpty()
                if (family.isNotEmpty()) {
                    lifecycleScope.launch {
                        app.brandKit.addFont(BrandFont(family))
                        refresh()
                    }
                }
            }
            .show()
    }

    private fun confirmRemoveColor(color: BrandColor) {
        lifecycleScope.launch {
            app.brandKit.removeColor(color.hex)
            refresh()
        }
    }

    private fun confirmRemoveFont(font: BrandFont) {
        lifecycleScope.launch {
            val kit = app.brandKit.load()
            app.brandKit.save(kit.copy(fonts = kit.fonts - font))
            refresh()
        }
    }

    private fun confirmRemoveLogo(logo: BrandLogo) {
        MaterialAlertDialogBuilder(this)
            .setMessage(getString(R.string.brand_delete_logo))
            .setNegativeButton(R.string.common_cancel, null)
            .setPositiveButton(R.string.common_delete) { _, _ ->
                lifecycleScope.launch {
                    app.brandKit.removeLogo(logo.path)
                    refresh()
                }
            }
            .show()
    }

    // ---- adapters -------------------------------------------------------------

    private class ColorAdapter(private val onRemove: (BrandColor) -> Unit) :
        ListAdapter<BrandColor, ColorAdapter.Holder>(Diff) {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder =
            Holder(ItemBrandColorBinding.inflate(LayoutInflater.from(parent.context), parent, false))

        override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(getItem(position))

        inner class Holder(private val binding: ItemBrandColorBinding) : RecyclerView.ViewHolder(binding.root) {
            fun bind(color: BrandColor) {
                val parsed = parseColorOr(color.hex, Color.WHITE)
                binding.swatch.setBackgroundColor(parsed)
                binding.name.text = color.displayName
                binding.root.setOnLongClickListener { onRemove(color); true }
            }
        }

        private object Diff : DiffUtil.ItemCallback<BrandColor>() {
            override fun areItemsTheSame(a: BrandColor, b: BrandColor): Boolean = a.hex == b.hex
            override fun areContentsTheSame(a: BrandColor, b: BrandColor): Boolean = a == b
        }
    }

    private class FontAdapter(private val onRemove: (BrandFont) -> Unit) :
        ListAdapter<BrandFont, FontAdapter.Holder>(Diff) {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder =
            Holder(ItemBrandColorBinding.inflate(LayoutInflater.from(parent.context), parent, false))

        override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(getItem(position))

        inner class Holder(private val binding: ItemBrandColorBinding) : RecyclerView.ViewHolder(binding.root) {
            fun bind(font: BrandFont) {
                binding.swatch.setBackgroundColor(Color.TRANSPARENT)
                binding.name.text = font.family
                binding.root.setOnLongClickListener { onRemove(font); true }
            }
        }

        private object Diff : DiffUtil.ItemCallback<BrandFont>() {
            override fun areItemsTheSame(a: BrandFont, b: BrandFont): Boolean = a.family == b.family
            override fun areContentsTheSame(a: BrandFont, b: BrandFont): Boolean = a == b
        }
    }

    private class LogoAdapter(private val onRemove: (BrandLogo) -> Unit) :
        ListAdapter<BrandLogo, LogoAdapter.Holder>(Diff) {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder =
            Holder(ItemBrandColorBinding.inflate(LayoutInflater.from(parent.context), parent, false))

        override fun onBindViewHolder(holder: Holder, position: Int) = holder.bind(getItem(position))

        inner class Holder(private val binding: ItemBrandColorBinding) : RecyclerView.ViewHolder(binding.root) {
            fun bind(logo: BrandLogo) {
                binding.swatch.setBackgroundColor(Color.TRANSPARENT)
                binding.name.text = logo.name
                binding.root.setOnLongClickListener { onRemove(logo); true }
            }
        }

        private object Diff : DiffUtil.ItemCallback<BrandLogo>() {
            override fun areItemsTheSame(a: BrandLogo, b: BrandLogo): Boolean = a.path == b.path
            override fun areContentsTheSame(a: BrandLogo, b: BrandLogo): Boolean = a == b
        }
    }
}
