//! PhotoCraft Mobile — C ABI bridge to the PhotoCraft engine.
//!
//! This crate is the *single* entry point between the Android app (Kotlin/JNI/C++)
//! and the vendored PhotoCraft Rust core (`photocraft-engine`, `photocraft-doc`,
//! `photocraft-psd`, `photocraft-text`, `photocraft-compose`, `photocraft-codecs`,
//! `photocraft-io`, `photocraft-format`, …).
//!
//! Design:
//! * One session object (`photocraft_automation::Headless`) per open editor document
//!   model, exactly like the upstream headless CLI/server uses. All document,
//!   layer, group, mask, blend, style, text, SVG, PSD/PSB and export operations are
//!   executed through the engine's own command registry via
//!   [`Headless::handle`] (`engine.execute`, `doc.new`, `doc.open`, `doc.save`,
//!   `doc.inspect`, `doc.render`, …). Nothing here is a mock: every call lands in
//!   the real, tested engine.
//! * Hot-path rendering (`pcm_render_rgba`) returns premultiplied-safe RGBA8 bytes
//!   of the flattened composite, decoded in-process, for the Android `SurfaceView`.
//! * Memory crossing the ABI is allocated here and freed here
//!   ([`pcm_string_free`], [`pcm_buffer_free`]).
//!
//! All exported functions are `extern "C"`, `#[no_mangle]`, never panic across the
//! boundary (errors are returned as JSON `{"error": "…"}` or null).

#![allow(unsafe_code)]

use std::ffi::{CStr, CString, c_char};
use std::panic::AssertUnwindSafe;
use std::slice;

use photocraft_automation::Headless;
use photocraft_codecs as codecs;

// ---------------------------------------------------------------------------
// String / buffer helpers
// ---------------------------------------------------------------------------

/// Library version string (static, must not be freed).
#[no_mangle]
pub extern "C" fn pcm_version() -> *const c_char {
    concat!(env!("CARGO_PKG_VERSION"), "\0").as_ptr() as *const c_char
}

/// Free a `*mut c_char` returned by this library.
#[no_mangle]
pub extern "C" fn pcm_string_free(s: *mut c_char) {
    if s.is_null() {
        return;
    }
    unsafe { drop(CString::from_raw(s)) };
}

/// Free a byte buffer returned by this library (`pcm_buffer_free(ptr, len)`).
#[no_mangle]
pub extern "C" fn pcm_buffer_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    unsafe { drop(Vec::from_raw_parts(ptr, len, len)) };
}

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
#[no_mangle]
pub extern "C" fn pcm_session_new() -> *mut Headless {
    let session =
        std::panic::catch_unwind(Headless::trusted_local).unwrap_or_else(|_| Headless::trusted_local());
    Box::into_raw(Box::new(session))
}

/// Destroy a session created by [`pcm_session_new`].
#[no_mangle]
pub extern "C" fn pcm_session_free(session: *mut Headless) {
    if session.is_null() {
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
    session: *mut Headless,
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
        let h = unsafe { &mut *session };
        // Apply finished background jobs (filters run with `wait:false`) so every
        // call — save, render, inspect — observes the document as of now.
        h.sync_jobs();
        let out = h
            .handle(&method, params)
            .map_err(|e| format!("{e}"))?;
        CString::new(out.to_string()).map_err(|e| format!("{e}"))
    })
}

/// List the full engine command registry as a JSON array (id, label, params).
#[no_mangle]
pub unsafe extern "C" fn pcm_command_list(session: *mut Headless) -> *mut c_char {
    if session.is_null() {
        return catch(|| Err("null session".into()));
    }
    catch(move || -> Result<CString, String> {
        let h = unsafe { &mut *session };
        let out = h.command_list();
        CString::new(out.to_string()).map_err(|e| format!("{e}"))
    })
}

// ---------------------------------------------------------------------------
// Hot-path rendering (SurfaceView frames)
// ---------------------------------------------------------------------------

/// Render the active document composite to tightly-packed RGBA8 (top-down rows),
/// sized so the longest side is at most `max_side` px. Writes the byte length to
/// `out_len`. Free with `pcm_buffer_free(ptr, len)`.
///
/// Returns null on error (e.g. no open document).
#[no_mangle]
pub unsafe extern "C" fn pcm_render_rgba(
    session: *mut Headless,
    max_side: u32,
    out_len: *mut usize,
) -> *mut u8 {
    let result = std::panic::catch_unwind(AssertUnwindSafe(move || -> Result<Vec<u8>, String> {
        let h = unsafe { &mut *session };
        let png = h.render_png(None, max_side).map_err(|e| format!("{e}"))?;
        let image = codecs::decode(&png).map_err(|e| format!("{e}"))?;
        Ok(image.to_rgba8())
    }));
    match result {
        Ok(Ok(rgba)) => {
            let len = rgba.len();
            let mut boxed = rgba;
            boxed.shrink_to_fit(); // ensure capacity == len for exact from_raw_parts
            let ptr = boxed.into_raw();
            if !out_len.is_null() {
                unsafe { *out_len = len };
            }
            ptr
        }
        _ => {
            if !out_len.is_null() {
                unsafe { *out_len = 0 };
            }
            std::ptr::null_mut()
        }
    }
}

// ---------------------------------------------------------------------------
// Direct byte helpers used by the AI modules (OCR / background removal)
// ---------------------------------------------------------------------------

/// Re-encode raw RGBA8 bytes as PNG (used to hand BiRefNet / OCR crops to the
/// engine without touching the disk). Returns PNG bytes; free with
/// `pcm_buffer_free`.
#[no_mangle]
pub unsafe extern "C" fn pcm_rgba8_to_png(
    rgba: *const u8,
    len: usize,
    width: u32,
    height: u32,
    out_len: *mut usize,
) -> *mut u8 {
    if rgba.is_null() || out_len.is_null() || len == 0 {
        if !out_len.is_null() {
            unsafe { *out_len = 0 };
        }
        return std::ptr::null_mut();
    }
    let result = std::panic::catch_unwind(AssertUnwindSafe(move || -> Result<Vec<u8>, String> {
        let data = unsafe { slice::from_raw_parts(rgba, len) }.to_vec();
        let expected = (width as usize) * (height as usize) * 4;
        if data.len() != expected {
            return Err(format!("rgba8 size mismatch: got {}, want {expected}", data.len()));
        }
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
            let mut boxed = bytes;
            boxed.shrink_to_fit(); // capacity == len
            unsafe { *out_len = l };
            boxed.into_raw().as_mut_ptr()
        }
        _ => {
            unsafe { *out_len = 0 };
            std::ptr::null_mut()
        }
    }
}
