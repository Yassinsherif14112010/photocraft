package ai.storyteller.photocraft.ui.templates

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import ai.storyteller.photocraft.data.DocumentPreset
import ai.storyteller.photocraft.databinding.ActivityTemplatesBinding
import ai.storyteller.photocraft.ui.common.gridSpan
import ai.storyteller.photocraft.ui.common.windowSizeClass

/**
 * The full template catalogue (social, print and blank sizes).
 *
 * Returns `RESULT_OK` with [EXTRA_PRESET_ID] so the home screen can create the document through
 * the engine with the same code path as the new-project sheet.
 */
class TemplatesActivity : AppCompatActivity() {

    private lateinit var binding: ActivityTemplatesBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityTemplatesBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.toolbar.setNavigationOnClickListener { finish() }

        val span = gridSpan(this, windowSizeClass())
        binding.recycler.layoutManager = GridLayoutManager(this, span)
        val adapter = PresetAdapter { preset ->
            setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_PRESET_ID, preset.id))
            finish()
        }
        binding.recycler.adapter = adapter
        adapter.submitList(DocumentPreset.ALL)
    }

    companion object {
        const val EXTRA_PRESET_ID = "preset_id"
    }
}
