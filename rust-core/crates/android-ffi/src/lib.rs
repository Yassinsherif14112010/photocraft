//! PhotoCraft Mobile — C ABI bridge to the PhotoCraft engine.
//!
//! This crate is the *single* entry point between the Android app (Kotlin/JNI/C++)
//! and the vendored PhotoCraft Rust core (`photocraft-engine`, `photocraft-doc`,
//! `photocraft-psd`, `photocraft-text`, `photocraft-compose`, `photocraft-codecs`,
//! `photocraft-io`, `photocraft-format`, …).
//!
//! # Ownership contract (the whole ABI in five rules)
//!
//! 1. **Sessions** — [`pcm_session_new`] returns an opaque `*mut PcmSession`.
//!    Exactly one call to [`pcm_session_free`] releases it. The handle is
//!    validated against a live-handle registry, so double-free and unknown
//!    handles are safe no-ops and never touch foreign memory. The caller must
//!    not run `pcm_session_free` concurrently with another call on the *same*
//!    session; concurrent *use* on different sessions is always safe.
//! 2. **Engine state** — every session serializes engine access behind a
//!    `Mutex`, so the whole C ABI is callable from any thread without data
//!    races. A poisoned lock is recovered (the engine call layer already
//!    catches panics before they can leave a half-applied mutation).
//! 3. **Byte buffers** — render/encode results cross the ABI as a
//!    `(ptr, len)` pair where the allocation is a `Box<[u8]>`
//!    (length == capacity is *guaranteed* by construction, never assumed from
//!    a `Vec`'s spare capacity). [`pcm_buffer_free`] reconstructs that exact
//!    boxed slice and frees it. Buffers must not be freed by any other
//!    mechanism, and never freed twice.
//! 4. **Strings** — JSON replies are `CString`s released with
//!    [`pcm_string_free`]. `pcm_version()` points at static storage and must
//!    NOT be freed. Empty replies are still valid allocations.
//! 5. **Integer widths** — nothing crosses the ABI as `usize`. Sizes use
//!    `u64` (C `uint64_t`), pixel dimensions use `u32` (C `uint32_t`); the
//!    declarations in `photocraft_jni.cpp` mirror this exactly, so the ABI is
//!    identical on armeabi-v7a, arm64-v8a and x86_64.
//!
//! All exported functions are `extern "C"`, `#[no_mangle]`, never panic across
//! the boundary (unwinds are caught; errors are returned as JSON
//! `{"error": "…"}` or a null pointer, never as a fabricated success).

#![allow(unsafe_code)]

use std::collections::HashSet;
use std::ffi::{CStr, CString, c_char};
use std::panic::AssertUnwindSafe;
use std::slice;
use std::sync::Mutex;

use photocraft_automation::Headless;
use photocraft_codecs as codecs;

// ---------------------------------------------------------------------------
// Session wrapper + live-handle registry
// ---------------------------------------------------------------------------

/// Opaque session object handed to the JNI layer.
///
/// The `Headless` engine is wrapped in a `Mutex` so the C ABI can be driven
/// from any thread (the JNI layer uses a single background executor today, but
/// nothing about the ABI requires that, and enforcing it in Rust removes a
/// whole class of data-race bugs).
pub struct PcmSession {
    headless: Mutex<Headless>,
}

impl PcmSession {
    fn lock(&self) -> std::sync::MutexGuard<'_, Headless> {
        // A panic inside an engine call is caught at the FFI boundary before it
        // can cross the C ABI; recovering the guard keeps the session usable
        // instead of poisoning it for the rest of the app's life.
        self.headless.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Registry of live session pointers: makes `pcm_session_free` idempotent and
/// rejects unknown/stale handles instead of freeing arbitrary memory.
static LIVE_SESSIONS: Mutex<Option<HashSet<usize>>> = Mutex::new(None);

fn track_session(ptr: usize) {
    let mut slot = LIVE_SESSIONS.lock().unwrap_or_else(|p| p.into_inner());
    slot.get_or_insert_with(HashSet::new).insert(ptr);
}

fn untrack_session(ptr: usize) -> bool {
    let mut slot = LIVE_SESSIONS.lock().unwrap_or_else(|p| p.into_inner());
    slot.as_mut().map(|set| set.remove(&ptr)).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// String / buffer helpers
// ---------------------------------------------------------------------------

/// Library version string (static storage; must not be freed).
#[no_mangle]
pub extern "C" fn pcm_version() -> *const c_char {
    concat!(env!("CARGO_PKG_VERSION"), "\0").as_ptr() as *const c_char
}

/// Free a `*mut c_char` returned by this library (except `pcm_version`).
/// Null is accepted and ignored.
#[no_mangle]
pub extern "C" fn pcm_string_free(s: *mut c_char) {
    if s.is_null() {
        return;
    }
    unsafe { drop(CString::from_raw(s)) };
}

/// Free a byte buffer returned by `pcm_render_rgba` / `pcm_rgba8_to_png`.
///
/// `len` is the exact length the buffer was returned with (including 0 — a
/// zero-length buffer is still a valid boxed-slice allocation with a dangling
/// but aligned pointer). Null is accepted and ignored. Freeing the same
/// (ptr, len) twice is undefined behaviour, like `free` in C; the JNI layer
/// releases each buffer exactly once.
#[no_mangle]
pub extern "C" fn pcm_buffer_free(ptr: *mut u8, len: u64) {
    if ptr.is_null() {
        return;
    }
    let len = len as usize; // u64 → usize is lossless on every supported ABI
    unsafe {
        // Sound: the buffer was created by `Box<[u8]>::into_raw()` with exactly
        // this length (into_boxed_slice guarantees len == capacity).
        drop(Box::from_raw(slice::from_raw_parts_mut(ptr, len)));
    }
}

/// Run `f`, converting panics and errors into JSON error strings. Never unwinds.
fn catch<F: FnOnce() -> Result<CString, String>>(f: F) -> *mut c_char {
    let result = std::panic::catch_unwind(AssertUnwindSafe(f));
    match result {
        Ok(Ok(s)) => s.into_raw(),
        Ok(Err(e)) => CString::new(format!(r#"{{"error":{}}}"#, json_escape(&e)))
            .unwrap_or_else(|_| CString::new("{\"error\":\"ffi\"}").unwrap())
            .into_raw(),
        Err(_) => CString::new("{\"error\":\"engine panic\"}").unwrap().into_raw(),
    }
}

fn json_escape(s: &str) -> String {
    serde_json::json!(s).to_string()
}

/// Read a NUL-terminated UTF-8 string handed in by the caller.
/// Null yields an empty string (callers validate separately).
unsafe fn read_str(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/// Create a new headless engine session (one per open document).
///
/// The Android app is the local, trusted caller (like the upstream CLI): it
/// supplies real host paths for `doc.open`, `doc.save` and `file.placeEmbedded`,
/// so the session gets the filesystem authority those commands require. An
/// authority-less session would reject every file operation.
///
/// Returns null only if session construction itself panicked (the previous
/// implementation retried the constructor, which could panic again across the
/// C ABI — returning null is total and the callers handle it).
#[no_mangle]
pub extern "C" fn pcm_session_new() -> *mut PcmSession {
    let constructed = std::panic::catch_unwind(Headless::trusted_local);
    let session = match constructed {
        Ok(session) => session,
        Err(_) => return std::ptr::null_mut(),
    };
    let boxed = Box::new(PcmSession { headless: Mutex::new(session) });
    let ptr = Box::into_raw(boxed);
    track_session(ptr as usize);
    ptr
}

/// Destroy a session created by [`pcm_session_new`].
///
/// Idempotent: null, already-freed and never-issued handles are ignored
/// without touching memory (the live-handle registry is the authority).
#[no_mangle]
pub extern "C" fn pcm_session_free(session: *mut PcmSession) {
    if session.is_null() {
        return;
    }
    if !untrack_session(session as usize) {
        // Unknown pointer: not created by us, or already destroyed. Refuse.
        return;
    }
    unsafe { drop(Box::from_raw(session)) };
}

/// Call an automation method with a JSON params object.
///
/// `method` examples: `doc.new`, `doc.open`, `doc.save`, `doc.inspect`,
/// `doc.render`, `doc.select`, `doc.close`, `engine.execute`, `engine.commands`,
/// `batch`, `session.list`.
/// For `engine.execute` params are `{"command": "layer.move", "params": {…}}`.
/// Returns a heap-allocated JSON string (free with [`pcm_string_free`]).
/// On error the JSON is `{"error": "…"}`.
#[no_mangle]
pub unsafe extern "C" fn pcm_call(
    session: *const PcmSession,
    method: *const c_char,
    params_json: *const c_char,
) -> *mut c_char {
    if session.is_null() {
        return catch(|| Err("null session".into()));
    }
    let method = unsafe { read_str(method) };
    let params_s = unsafe { read_str(params_json) };
    catch(move || -> Result<CString, String> {
        let params: serde_json::Value = if params_s.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&params_s).map_err(|e| format!("bad params JSON: {e}"))?
        };
        let h = &*session;
        let mut engine = h.lock();
        // Apply finished background jobs (filters run with `wait:false`) so every
        // call — save, render, inspect — observes the document as of now.
        engine.sync_jobs();
        let out = engine
            .handle(&method, params)
            .map_err(|e| format!("{e}"))?;
        CString::new(out.to_string()).map_err(|e| format!("{e}"))
    })
}

/// List the full engine command registry as a JSON array (id, label, params).
#[no_mangle]
pub unsafe extern "C" fn pcm_command_list(session: *const PcmSession) -> *mut c_char {
    if session.is_null() {
        return catch(|| Err("null session".into()));
    }
    catch(move || -> Result<CString, String> {
        let h = &*session;
        let out = h.lock().command_list();
        CString::new(out.to_string()).map_err(|e| format!("{e}"))
    })
}

// ---------------------------------------------------------------------------
// Hot-path rendering (SurfaceView frames)
// ---------------------------------------------------------------------------

/// Render the active document composite to tightly-packed RGBA8 (top-down rows)
/// sized so the longest side is at most `max_side` px.
///
/// Writes the exact byte length to `out_len` (uint64) and the exact pixel
/// dimensions to `out_w` / `out_h` (uint32) — callers must not derive the
/// layout from the document aspect or any other guess; the buffer is
/// `w * h * 4` bytes with `w * 4` bytes per row.
///
/// Free with `pcm_buffer_free(ptr, len)`. Returns null on error (e.g. no open
/// document) with `*out_len` set to 0. All three out-pointers must be valid.
#[no_mangle]
pub unsafe extern "C" fn pcm_render_rgba(
    session: *const PcmSession,
    max_side: u32,
    out_len: *mut u64,
    out_w: *mut u32,
    out_h: *mut u32,
) -> *mut u8 {
    if out_len.is_null() || out_w.is_null() || out_h.is_null() {
        return std::ptr::null_mut();
    }
    unsafe {
        *out_len = 0;
        *out_w = 0;
        *out_h = 0;
    }
    if session.is_null() || max_side == 0 {
        return std::ptr::null_mut();
    }
    let result = std::panic::catch_unwind(AssertUnwindSafe(move || -> Result<(Vec<u8>, u32, u32), String> {
        let h = &*session;
        let png = h.lock().render_png(None, max_side).map_err(|e| format!("{e}"))?;
        let image = codecs::decode(&png).map_err(|e| format!("{e}"))?;
        let (w, hh) = (image.width(), image.height());
        Ok((image.to_rgba8(), w, hh))
    }));
    match result {
        Ok(Ok((rgba, w, hh))) => {
            let len = rgba.len();
            let slice = rgba.into_boxed_slice(); // guarantees len == capacity
            let ptr = Box::into_raw(slice) as *mut u8;
            unsafe {
                *out_len = len as u64;
                *out_w = w;
                *out_h = hh;
            }
            ptr
        }
        _ => std::ptr::null_mut(), // *out_len already 0
    }
}

// ---------------------------------------------------------------------------
// Direct byte helpers used by the AI modules (OCR / background removal)
// ---------------------------------------------------------------------------

/// Re-encode raw RGBA8 bytes as PNG (used to hand BiRefNet / OCR crops to the
/// engine without touching the disk). Returns PNG bytes; free with
/// `pcm_buffer_free`. `len` must equal `width * height * 4`.
#[no_mangle]
pub unsafe extern "C" fn pcm_rgba8_to_png(
    rgba: *const u8,
    len: u64,
    width: u32,
    height: u32,
    out_len: *mut u64,
) -> *mut u8 {
    if rgba.is_null() || out_len.is_null() || len == 0 {
        if !out_len.is_null() {
            unsafe { *out_len = 0 };
        }
        return std::ptr::null_mut();
    }
    unsafe { *out_len = 0 };
    let result = std::panic::catch_unwind(AssertUnwindSafe(move || -> Result<Vec<u8>, String> {
        // u64 → usize: on 32-bit ABIs a >4 GiB request would truncate; reject it
        // explicitly instead of misinterpreting the length.
        let len_usize = usize::try_from(len).map_err(|_| "buffer too large for this platform")?;
        let expected = (width as u64) * (height as u64) * 4;
        if len != expected {
            return Err(format!("rgba8 size mismatch: got {len}, want {expected}"));
        }
        let data = unsafe { slice::from_raw_parts(rgba, len_usize) }.to_vec();
        let image = codecs::Image::from_raw(
            width,
            height,
            codecs::ChannelLayout::Rgba,
            codecs::SampleType::U8,
            data,
        )
        .map_err(|e| format!("{e}"))?;
        codecs::encode(
            &image,
            codecs::Format::Png,
            &codecs::EncodeOptions::default(),
        )
        .map_err(|e| format!("{e}"))
    }));
    match result {
        Ok(Ok(bytes)) => {
            let l = bytes.len();
            let slice = bytes.into_boxed_slice(); // guarantees len == capacity
            let ptr = Box::into_raw(slice) as *mut u8;
            unsafe { *out_len = l as u64 };
            ptr
        }
        _ => std::ptr::null_mut(), // *out_len already 0
    }
}

// ---------------------------------------------------------------------------
// Tests — buffer ownership round-trip and registry semantics.
// NOTE: executed by `cargo test -p photocraft-android-ffi` on a machine with
// the Rust toolchain; this environment has no cargo, so they were NOT run here.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffer_free_round_trip_exact_len() {
        let v: Vec<u8> = (0..1024u8).collect();
        let len = v.len();
        let slice = v.into_boxed_slice();
        let ptr = Box::into_raw(slice) as *mut u8;
        pcm_buffer_free(ptr, len as u64);
    }

    #[test]
    fn buffer_free_handles_null_and_zero() {
        pcm_buffer_free(std::ptr::null_mut(), 0);
        // Empty boxed slice: dangling-but-aligned pointer with len 0.
        let empty = Vec::<u8>::new().into_boxed_slice();
        let ptr = Box::into_raw(empty) as *mut u8;
        pcm_buffer_free(ptr, 0);
    }

    #[test]
    fn session_registry_rejects_unknown_and_double_free() {
        // Unknown handle is a no-op (would be UB without the registry).
        let fake = 0xdead_beefusize as *mut PcmSession;
        pcm_session_free(fake);
        // Real session: first free works, second is a no-op.
        let s = pcm_session_new();
        assert!(!s.is_null());
        pcm_session_free(s);
        pcm_session_free(s);
    }

    #[test]
    fn null_session_calls_report_errors_not_success() {
        let reply = unsafe {
            let p = pcm_call(std::ptr::null(), b"doc.inspect\0".as_ptr() as *const c_char, b"{}\0".as_ptr() as *const c_char);
            let s = std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned();
            pcm_string_free(p as *mut c_char);
            s
        };
        assert!(reply.contains("\"error\""), "expected error JSON, got {reply}");
    }

    #[test]
    fn render_requires_out_pointers() {
        let s = pcm_session_new();
        assert!(!s.is_null());
        let mut len = 0u64;
        let ptr = unsafe { pcm_render_rgba(s, 64, &mut len, std::ptr::null_mut(), std::ptr::null_mut()) };
        assert!(ptr.is_null());
        pcm_session_free(s);
    }
}
