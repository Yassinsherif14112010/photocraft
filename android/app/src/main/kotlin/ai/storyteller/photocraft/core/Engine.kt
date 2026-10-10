package ai.storyteller.photocraft.core

import android.graphics.Bitmap
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.util.concurrent.Executors

/** Thrown by the Rust bridge for a programming-level failure (bad handle, impossible argument). */
class EngineException(message: String) : RuntimeException(message)

/** A command the engine refused to run because of the document's state (not a bug). */
class CommandException(val command: String, message: String) : Exception(message)

/**
 * One open document in the real engine.
 *
 * [Engine] is a thin handle over a Rust [photocraft_engine::Session]: every edit goes through the
 * engine's command registry, every composite comes from the engine's compositor, and undo/redo is
 * the engine's history. Nothing is cached in Kotlin that the engine owns.
 *
 * All calls block (they do real work), so they run on [engineDispatcher] — a single-threaded
 * dispatcher, because a document's history must be mutated in the order the UI requested.
 */
class Engine internal constructor(internal val handle: Long) : Closeable {

    // ---- commands ----------------------------------------------------------

    /**
     * Runs an engine command by id (for example `layer.new.layer`, `image.crop`,
     * `layer.removeBackground`, `type.create`) with its JSON parameters.
     *
     * @return the command's result value (`JSONObject.NULL` when it returns nothing).
     * @throws CommandException when the engine cannot run it right now.
     */
    fun execute(command: String, params: JSONObject = JSONObject()): Any {
        val envelope = JSONObject(NativeBridge.nativeExecute(handle, command, params.toString()))
        if (!envelope.optBoolean("ok", false)) {
            throw CommandException(command, envelope.optString("error", "$command failed"))
        }
        return envelope.opt("result") ?: JSONObject.NULL
    }

    /** Runs a command that is allowed to fail, returning `false` instead of throwing. */
    fun tryExecute(command: String, params: JSONObject = JSONObject()): Boolean =
        runCatching { execute(command, params) }.isSuccess

    /** Whether a command can run, for enabled/disabled UI state. */
    fun isEnabled(command: String): Boolean = NativeBridge.nativeIsEnabled(handle, command)

    /** Why a command is disabled, or `null`. */
    fun disabledReason(command: String): String? = NativeBridge.nativeDisabledReason(handle, command)

    fun undo(): Boolean = NativeBridge.nativeUndo(handle)
    fun redo(): Boolean = NativeBridge.nativeRedo(handle)

    // ---- state -------------------------------------------------------------

    /** Everything the layers panel and the top bar show. */
    fun info(): DocumentInfo = DocumentInfo.parse(JSONObject(NativeBridge.nativeDocumentInfo(handle)))

    /** Importer notes (approximations, dropped features) to show once after opening a file. */
    fun warnings(): List<String> {
        val array = JSONArray(NativeBridge.nativeWarnings(handle))
        return (0 until array.length()).map { array.optString(it) }.filter { it.isNotBlank() }
    }

    // ---- rendering ---------------------------------------------------------

    /**
     * Composites the document into a [Bitmap] no larger than [maxSide] on its long side. The
     * aspect ratio is preserved (never squeezed) and the alpha channel is real, so the canvas can
     * show the transparency checkerboard through it.
     */
    fun render(maxSide: Int): Bitmap {
        val wire = NativeBridge.nativeRenderArgb(handle, maxSide.coerceIn(1, 16_384))
        require(wire.size >= 2) { "the engine returned no image header" }
        val width = wire[0]
        val height = wire[1]
        require(width > 0 && height > 0) { "the engine returned an empty image" }
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val pixels = wire.size - 2
        require(pixels >= width * height) { "the engine returned a short pixel buffer" }
        bitmap.setPixels(wire, 2, width, 0, 0, width, height)
        return bitmap
    }

    // ---- saving and exporting ---------------------------------------------

    /** The layered native document (`.pcraft`): every layer, mask and effect survives. */
    fun savePcraft(): ByteArray = NativeBridge.nativeSavePcraft(handle)

    /** A flat export (`png`, `jpg`, `webp`, `tif`, `psd`, `pcraft`) of the document as it is. */
    fun export(nameOrExt: String, options: JSONObject = JSONObject()): ByteArray =
        NativeBridge.nativeExport(handle, nameOrExt, options.toString())

    /**
     * Exports a **resized copy**. The open document is never resized: the Rust side duplicates the
     * document into a throwaway session and resizes that, so "export at 1080 px" cannot shrink the
     * user's project.
     */
    fun exportScaled(
        nameOrExt: String,
        width: Int,
        height: Int,
        options: JSONObject = JSONObject()
    ): ByteArray = NativeBridge.nativeExportScaled(handle, nameOrExt, width, height, options.toString())

    // ---- background removal ------------------------------------------------

    /**
     * Applies a grayscale mask (one byte per pixel, 0 = hide, 255 = reveal, in document pixel
     * coordinates) to a layer as a **non-destructive layer mask**: one history step, undoable, and
     * the layer's pixels are untouched.
     */
    fun applyAlphaMask(layerId: Long, mask: ByteArray, width: Int, height: Int, label: String = "Remove Background") {
        val applied = NativeBridge.nativeApplyAlphaMask(handle, layerId, mask, width, height, label)
        if (!applied) throw CommandException("layer.mask", "the mask could not be applied to this layer")
    }

    // ---- lifecycle ---------------------------------------------------------

    /** True until [close]: a closed handle is never reused. */
    private var open = true

    val isOpen: Boolean get() = open

    override fun close() {
        if (open) {
            open = false
            NativeBridge.nativeClose(handle)
        }
    }

    companion object {

        /**
         * Engine calls are serialized on one thread: a document's history has a single order, and
         * the compositor is happy to use every core internally (rayon) once it is called.
         */
        private val engineThreads = Executors.newSingleThreadExecutor { r ->
            Thread(r, "photocraft-engine").apply { isDaemon = true }
        }

        val engineDispatcher: CoroutineDispatcher = engineThreads.asCoroutineDispatcher()

        /** File › New. `background`: white | black | transparent | #rrggbb. */
        fun newDocument(
            width: Int,
            height: Int,
            background: String = "white",
            name: String = "Untitled",
            resolution: Int = 72,
            depth: Int = 8
        ): Engine {
            val handle = NativeBridge.nativeNewDocument(
                JSONObject().apply {
                    put("width", width)
                    put("height", height)
                    put("background", background)
                    put("name", name)
                    put("resolution", resolution)
                    put("depth", depth)
                }.toString()
            )
            return Engine(checked(handle, "could not create the document"))
        }

        /**
         * Opens bytes from a content URI, a shared file or an asset. PSD/PSB, Affinity, camera raws
         * and flat images are detected by magic by the engine's importer.
         */
        fun openBytes(name: String, bytes: ByteArray): Engine {
            val handle = NativeBridge.nativeOpenBytes(name, bytes)
            return Engine(checked(handle, "could not open $name"))
        }

        /** Opens a file inside the app's private storage (projects, autosave). */
        fun openPath(path: String): Engine {
            val handle = NativeBridge.nativeOpenPath(path)
            return Engine(checked(handle, "could not open $path"))
        }

        private fun checked(handle: Long, message: String): Long {
            if (handle == 0L) throw EngineException(message)
            return handle
        }
    }
}

/** Runs [block] on the engine thread and returns its result. */
suspend fun <T> onEngine(block: () -> T): T = withContext(Engine.engineDispatcher) { block() }

/** Runs [block] on the engine thread, for fire-and-forget work that updates state itself. */
suspend fun <T> onEngineIo(block: () -> T): T = withContext(Dispatchers.IO) { block() }
