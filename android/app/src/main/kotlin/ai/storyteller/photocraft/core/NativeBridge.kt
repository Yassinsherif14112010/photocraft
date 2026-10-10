package ai.storyteller.photocraft.core

/**
 * The Java side of the Rust bridge.
 *
 * Every function here is implemented in Rust in `android/jni-rust/src/lib.rs`
 * (`Java_ai_storyteller_photocraft_core_NativeBridge_*`) and drives the real PhotoCraft engine:
 * `photocraft-engine`'s command registry, `photocraft-compose`'s CPU compositor, `photocraft-io`'s
 * importers/exporters and `photocraft-format`'s `.pcraft` reader/writer. There is no second
 * (JavaScript or Kotlin) document model anywhere in the app.
 *
 * Contract:
 *  * a bad handle or an impossible argument throws [EngineException];
 *  * a command that legitimately cannot run (no document, locked layer, unreadable file) returns
 *    a JSON envelope `{"ok":false,"error":"…"}` — see [Engine.execute].
 */
internal object NativeBridge {

    /** Loads `libphotocraft.so`, built by `cargo ndk` from `android/jni-rust`. */
    fun load() {
        System.loadLibrary("photocraft")
        nativeInit()
    }

    external fun nativeInit()
    external fun nativeVersion(): String

    // ---- documents ----
    external fun nativeNewDocument(optionsJson: String): Long
    external fun nativeOpenBytes(name: String, bytes: ByteArray): Long
    external fun nativeOpenPath(path: String): Long
    external fun nativeClose(handle: Long)

    // ---- commands and history ----
    external fun nativeExecute(handle: Long, command: String, paramsJson: String): String
    external fun nativeIsEnabled(handle: Long, command: String): Boolean
    external fun nativeDisabledReason(handle: Long, command: String): String?
    external fun nativeUndo(handle: Long): Boolean
    external fun nativeRedo(handle: Long): Boolean

    // ---- state ----
    external fun nativeDocumentInfo(handle: Long): String
    external fun nativeWarnings(handle: Long): String

    // ---- rendering ----
    /** `[width, height, argb…]`, straight alpha, for `Bitmap.setPixels`. */
    external fun nativeRenderArgb(handle: Long, maxSide: Int): IntArray

    // ---- saving and exporting ----
    external fun nativeSavePcraft(handle: Long): ByteArray
    external fun nativeExport(handle: Long, nameOrExt: String, optionsJson: String): ByteArray
    external fun nativeExportScaled(
        handle: Long,
        nameOrExt: String,
        width: Int,
        height: Int,
        optionsJson: String
    ): ByteArray

    // ---- model-driven background removal ----
    external fun nativeApplyAlphaMask(
        handle: Long,
        layerId: Long,
        mask: ByteArray,
        width: Int,
        height: Int,
        label: String
    ): Boolean
}
