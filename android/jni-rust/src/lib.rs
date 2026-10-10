//! JNI surface of the PhotoCraft Android bridge.
//!
//! This file is deliberately *mechanical*: it converts Java values to Rust, calls
//! [`core::Registry`] (which drives the real engine) and converts the result back. No editing
//! logic lives here, so the engine-facing half is unit-testable on the host (`tests/core_tests.rs`).
//!
//! Kotlin counterpart: `ai.storyteller.photocraft.core.NativeBridge`. Every `external fun` below
//! has exactly one `Java_ai_storyteller_photocraft_core_NativeBridge_*` symbol; the repository
//! test `tools/check_jni_symbols.py` fails if the two lists ever drift apart.
//!
//! Errors are reported two ways on purpose:
//!
//! * a **bad handle** or an impossible argument throws `EngineException` (a bug in the app);
//! * a **command that cannot run** (no document, locked layer, unsupported file) returns a JSON
//!   envelope `{"ok":false,"error":"…"}` — an expected outcome the UI shows as a message.
//!
//! Nothing here panics: a panic across the JNI boundary aborts the process and loses the user's
//! work, so every failure is converted to an error value.

#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

pub mod core;

use std::sync::{LazyLock, Mutex, MutexGuard};

use jni::objects::{JByteArray, JClass, JIntArray, JString};
use jni::sys::{jboolean, jint, jlong, JNI_FALSE, JNI_TRUE, JNI_VERSION_1_6};
use jni::JNIEnv;
use log::LevelFilter;
use serde_json::{Value, json};

use crate::core::{BResult, BridgeError, Registry};

/// Kotlin class thrown for bridge-level failures.
const EXCEPTION: &str = "ai/storyteller/photocraft/core/EngineException";

/// One registry for the process. A `Mutex` (not a `RwLock`) keeps the mutation order of a
/// document's history exactly the order the UI requested, even when render and edit threads race.
static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(Registry::new);

fn registry() -> MutexGuard<'static, Registry> {
    // A poisoned lock still holds valid documents; dropping the user's work on the floor is worse
    // than continuing with the last known-good state.
    REGISTRY.lock().unwrap_or_else(|e| e.into_inner())
}

/// Called by the JVM when `System.loadLibrary("photocraft")` runs: routes `log` to logcat.
#[no_mangle]
pub extern "system" fn JNI_OnLoad(_vm: jni::JavaVM, _reserved: *mut std::ffi::c_void) -> jint {
    android_logger::init_once(
        android_logger::Config::default().with_max_level(LevelFilter::Info).with_tag("photocraft"),
    );
    log::info!("Photocraft engine loaded (v{})", env!("CARGO_PKG_VERSION"));
    JNI_VERSION_1_6
}

#[no_mangle]
pub extern "system" fn JNI_OnUnload(_vm: jni::JavaVM, _reserved: *mut std::ffi::c_void) {
    // Release every document (and its pixels) when the class loader goes away.
    let mut reg = registry();
    reg.clear();
}

// ---------- marshalling helpers ----------

fn to_string<'local>(env: &mut JNIEnv<'local>, s: &JString<'local>) -> BResult<String> {
    let jstr = env.get_string(s).map_err(|e| BridgeError(format!("argument is not a string: {e}")))?;
    Ok(String::from(jstr))
}

fn to_bytes<'local>(env: &JNIEnv<'local>, array: &JByteArray<'local>) -> BResult<Vec<u8>> {
    env.convert_byte_array(array).map_err(|e| BridgeError(format!("argument is not a byte[]: {e}")))
}

fn to_json<'local>(env: &mut JNIEnv<'local>, s: &JString<'local>) -> BResult<Value> {
    let text = to_string(env, s)?;
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| BridgeError(format!("invalid JSON: {e}")))
}

fn to_jstring<'local>(env: &mut JNIEnv<'local>, text: &str) -> JString<'local> {
    match env.new_string(text) {
        Ok(s) => s,
        Err(e) => {
            log::error!("could not allocate a Java string: {e}");
            JString::default()
        }
    }
}

fn to_byte_array<'local>(env: &mut JNIEnv<'local>, bytes: &[u8]) -> JByteArray<'local> {
    match env.byte_array_from_slice(bytes) {
        Ok(a) => a,
        Err(e) => {
            log::error!("could not allocate byte[{}]: {e}", bytes.len());
            JByteArray::default()
        }
    }
}

/// Throws `EngineException` and returns the type's default value (0 / null / false).
fn throw<T: Default>(env: &mut JNIEnv<'_>, message: &str) -> T {
    log::error!("{message}");
    if let Err(e) = env.throw_new(EXCEPTION, message) {
        log::error!("could not throw {EXCEPTION}: {e}");
    }
    T::default()
}

/// Runs `f`, turning a bridge error into a thrown exception.
fn guarded<T: Default>(env: &mut JNIEnv<'_>, f: impl FnOnce(&mut Registry) -> BResult<T>) -> T {
    let mut reg = registry();
    match f(&mut reg) {
        Ok(v) => v,
        Err(e) => throw(env, &e.0),
    }
}

/// Converts a Java argument, throwing instead of returning on a conversion failure.
macro_rules! arg {
    ($env:expr, $e:expr) => {
        match $e {
            Ok(v) => v,
            Err(err) => return throw($env, &err.0),
        }
    };
}

fn handle_of(handle: jlong) -> u64 {
    handle.max(0) as u64
}

// ---------- lifecycle ----------

#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeInit<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
) {
    guarded(&mut env, |reg| {
        log::info!("engine ready ({} document(s) open)", reg.len());
        Ok(())
    })
}

#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeVersion<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
) -> JString<'local> {
    to_jstring(&mut env, concat!(env!("CARGO_PKG_VERSION"), "+engine"))
}

/// File › New. `optionsJson` is the `file.new` parameter object.
#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeNewDocument<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    options: JString<'local>,
) -> jlong {
    let params = arg!(&mut env, to_json(&mut env, &options));
    guarded(&mut env, |reg| reg.new_document(&params).map(|h| h as jlong))
}

/// Opens bytes from a content URI, a shared file or an asset. Returns 0 and throws on failure.
#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeOpenBytes<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    name: JString<'local>,
    bytes: JByteArray<'local>,
) -> jlong {
    let name = arg!(&mut env, to_string(&mut env, &name));
    let data = arg!(&mut env, to_bytes(&env, &bytes));
    guarded(&mut env, |reg| reg.open_bytes(&name, &data).map(|h| h as jlong))
}

/// Opens a file by path inside the app's private storage (autosave, `file.open`, `placeEmbedded`).
#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeOpenPath<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    path: JString<'local>,
) -> jlong {
    let path = arg!(&mut env, to_string(&mut env, &path));
    guarded(&mut env, |reg| reg.open_path(&path).map(|h| h as jlong))
}

/// Closes a document and frees its pixels. Unknown handles are ignored (a double close is safe).
#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeClose<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) {
    guarded(&mut env, |reg| {
        reg.close(handle_of(handle));
        Ok(())
    })
}

// ---------- commands and history ----------

/// Runs any engine command. Returns `{"ok":true,"result":…}` or `{"ok":false,"error":"…"}`.
#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeExecute<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    command: JString<'local>,
    params: JString<'local>,
) -> JString<'local> {
    let command = arg!(&mut env, to_string(&mut env, &command));
    let params = arg!(&mut env, to_json(&mut env, &params));
    let out = guarded(&mut env, |reg| {
        match reg.execute(handle_of(handle), &command, &params) {
            Ok(result) => Ok(json!({ "ok": true, "result": result })),
            Err(e) => Ok(json!({ "ok": false, "error": e.0 })),
        }
    });
    to_jstring(&mut env, &out.to_string())
}

#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeIsEnabled<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    command: JString<'local>,
) -> jboolean {
    let command = arg!(&mut env, to_string(&mut env, &command));
    let reg = registry();
    let enabled = reg.is_enabled(handle_of(handle), &command);
    drop(reg);
    if enabled { JNI_TRUE } else { JNI_FALSE }
}

/// Why a command is disabled, or `null` when it is available.
#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeDisabledReason<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    command: JString<'local>,
) -> JString<'local> {
    let command = arg!(&mut env, to_string(&mut env, &command));
    let reason = guarded(&mut env, |reg| Ok(reg.disabled_reason(handle_of(handle), &command)));
    match reason {
        Some(text) => to_jstring(&mut env, &text),
        None => JString::default(),
    }
}

#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeUndo<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) -> jboolean {
    if guarded(&mut env, |reg| reg.undo(handle_of(handle))) { JNI_TRUE } else { JNI_FALSE }
}

#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeRedo<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) -> jboolean {
    if guarded(&mut env, |reg| reg.redo(handle_of(handle))) { JNI_TRUE } else { JNI_FALSE }
}

// ---------- document state ----------

#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeDocumentInfo<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) -> JString<'local> {
    let info = guarded(&mut env, |reg| reg.document_info(handle_of(handle)));
    to_jstring(&mut env, &info.to_string())
}

/// Import notes (approximations, dropped features) to show once after opening a file.
#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeWarnings<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) -> JString<'local> {
    let warnings = guarded(&mut env, |reg| Ok(reg.get(handle_of(handle))?.warnings.clone()));
    to_jstring(&mut env, &serde_json::to_string(&warnings).unwrap_or_else(|_| "[]".to_string()))
}

// ---------- rendering ----------

/// Composites the document and returns `[width, height, argb…]` for `Bitmap.setPixels`.
#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeRenderArgb<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    max_side: jint,
) -> JIntArray<'local> {
    let pixels = guarded(&mut env, |reg| Ok(reg.render_argb(handle_of(handle), max_side.max(1) as u32)?.to_int_array()));
    match env.new_int_array(pixels.len() as jni::sys::jsize) {
        Ok(array) => {
            if let Err(e) = env.set_int_array_region(&array, 0, &pixels) {
                log::error!("could not fill the int[]: {e}");
            }
            array
        }
        Err(e) => {
            log::error!("could not allocate int[{}]: {e}", pixels.len());
            JIntArray::default()
        }
    }
}

// ---------- saving and exporting ----------

#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeSavePcraft<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) -> JByteArray<'local> {
    let bytes = guarded(&mut env, |reg| reg.save_pcraft(handle_of(handle)));
    to_byte_array(&mut env, &bytes)
}

#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeExport<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    name_or_ext: JString<'local>,
    options: JString<'local>,
) -> JByteArray<'local> {
    let name = arg!(&mut env, to_string(&mut env, &name_or_ext));
    let opts = arg!(&mut env, to_json(&mut env, &options));
    let bytes = guarded(&mut env, |reg| reg.export(handle_of(handle), &name, &opts));
    to_byte_array(&mut env, &bytes)
}

/// Exports a resized copy. **The open document is never resized**: the resize happens on a
/// throwaway session, so "export at 1080 px" cannot destroy the user's full-resolution work.
#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeExportScaled<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    name_or_ext: JString<'local>,
    width: jint,
    height: jint,
    options: JString<'local>,
) -> JByteArray<'local> {
    let name = arg!(&mut env, to_string(&mut env, &name_or_ext));
    let opts = arg!(&mut env, to_json(&mut env, &options));
    let bytes = guarded(&mut env, |reg| {
        reg.export_scaled(handle_of(handle), &name, width.max(1) as u32, height.max(1) as u32, &opts)
    });
    to_byte_array(&mut env, &bytes)
}

// ---------- model-driven background removal ----------

/// Applies a model mask to a layer as a non-destructive layer mask (one history step).
#[no_mangle]
pub extern "system" fn Java_ai_storyteller_photocraft_core_NativeBridge_nativeApplyAlphaMask<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    layer_id: jlong,
    mask: JByteArray<'local>,
    width: jint,
    height: jint,
    label: JString<'local>,
) -> jboolean {
    let data = arg!(&mut env, to_bytes(&env, &mask));
    let label = arg!(&mut env, to_string(&mut env, &label));
    let applied = guarded(&mut env, |reg| {
        reg.apply_alpha_mask(
            handle_of(handle),
            handle_of(layer_id),
            &data,
            width.max(1) as u32,
            height.max(1) as u32,
            &label,
        )
    });
    if applied { JNI_TRUE } else { JNI_FALSE }
}

#[cfg(test)]
mod tests {
    use super::core::RenderedImage;

    /// The wire format Kotlin expects: two header words then the pixels.
    #[test]
    fn rendered_image_wire_format_has_a_header() {
        let img = RenderedImage::from_rgba(2, 1, &[255, 0, 0, 255, 0, 255, 0, 128]);
        let wire = img.to_int_array();
        assert_eq!(&wire[..2], &[2, 1]);
        assert_eq!(wire[2], 0xFFFF_0000u32 as i32);
        assert_eq!(wire[3], (0x80 << 24) | 0x00FF_00);
    }

    #[test]
    fn rendered_image_is_never_shorter_than_the_frame() {
        let img = RenderedImage::from_rgba(4, 4, &[]);
        assert_eq!(img.argb.len(), 16);
    }
}
