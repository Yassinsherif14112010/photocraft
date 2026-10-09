package com.photocraft.mobile.engine

/**
 * Typed JNI surface of the PhotoCraft Rust core (libphotocraft_android_ffi.so).
 *
 * Each `native*` function maps 1:1 onto the C ABI in
 * rust-core/crates/android-ffi/src/lib.rs and is bridged by
 * cpp/photocraft_jni.cpp. Instances are used through [PhotoCraftEngine],
 * which owns the session pointer lifetime.
 */
object PhotoCraftJni {
    init {
        System.loadLibrary("photocraft_mobile_jni")
    }

    /** Version of the Rust engine core. */
    external fun nativeVersion(): String

    /** Allocate a headless engine session. Returns a native handle (never 0 on success). */
    external fun nativeSessionNew(): Long

    /** Release a session created by [nativeSessionNew]. Safe to call with 0. */
    external fun nativeSessionFree(session: Long)

    /**
     * Execute one automation method (`doc.new`, `doc.open`, `doc.save`, `doc.inspect`,
     * `doc.render`, `engine.execute`, `batch`, …) and return the JSON reply.
     * On failure the reply is `{"error": "…"}` — never throws, never blocks forever.
     */
    external fun nativeCall(session: Long, method: String, paramsJson: String): String

    /** Full engine command registry as a JSON array. */
    external fun nativeCommandList(session: Long): String

    /**
     * Render the active document composite as tightly packed RGBA8 bytes.
     * `sizeOut` (LongArray size >= 3) receives `[byteLength, width, height]` —
     * the frame layout is exact engine output, never derived from the document
     * aspect. The buffer is `width * height * 4` bytes, `width * 4` per row.
     */
    external fun nativeRenderRgba(session: Long, maxSide: Int, sizeOut: LongArray): ByteArray

    /** Encode raw RGBA8 into PNG bytes through the engine's codec stack. */
    external fun nativeRgba8ToPng(rgba: ByteArray, width: Int, height: Int): ByteArray
}
