//! Engine-facing core of the Android bridge: **no JNI types, no `unsafe`**.
//!
//! Everything the Android app can do goes through this module, and every operation mutates a
//! real [`photocraft_engine::Session`] (real document, real history, real compositor, real
//! `.pcraft` / PSD / PNG codecs). Keeping it JNI-free means it is unit-testable on the host with
//! a plain `cargo test` (see `tests/core_tests.rs`) — the JNI layer in `lib.rs` is a thin,
//! mechanical marshalling shell over these functions.

use std::collections::HashMap;
use std::path::Path;

use photocraft_color::PixelFormat;
use photocraft_doc::{Document, LayerId, LayerMask};
use photocraft_engine::Session;
use photocraft_geom::Rect;
use photocraft_raster::Surface;
use serde_json::{Value, json};

/// A document open in the engine, plus whatever the UI needs to show about it.
pub struct OpenDocument {
    pub session: Session,
    /// Notes from the importer (approximations, dropped features). Shown once after an import.
    pub warnings: Vec<String>,
    /// Set for imports PhotoCraft cannot write back to (Affinity).
    pub read_only_source: bool,
}

impl OpenDocument {
    fn new(session: Session) -> Self {
        Self { session, warnings: Vec::new(), read_only_source: false }
    }
}

/// All open documents. Handles are opaque `u64`s on the Kotlin side; `0` is never a valid handle,
/// so Kotlin can use `0` as "no document" and the JNI layer can return `0` after throwing.
#[derive(Default)]
pub struct Registry {
    docs: HashMap<u64, OpenDocument>,
    next: u64,
}

/// The error type crossing the JNI boundary: a human-readable message, never a panic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeError(pub String);

impl std::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for BridgeError {}

impl From<String> for BridgeError {
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for BridgeError {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

pub type BResult<T> = Result<T, BridgeError>;

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    fn insert(&mut self, doc: OpenDocument) -> u64 {
        // Handles start at 1 and never repeat inside a process, so a stale handle stays invalid
        // after a close (the app can never edit a document it already closed).
        self.next = self.next.wrapping_add(1).max(1);
        let handle = self.next;
        self.docs.insert(handle, doc);
        handle
    }

    pub fn get(&self, handle: u64) -> BResult<&OpenDocument> {
        self.docs.get(&handle).ok_or_else(|| BridgeError(format!("no document with handle {handle}")))
    }

    pub fn get_mut(&mut self, handle: u64) -> BResult<&mut OpenDocument> {
        self.docs.get_mut(&handle).ok_or_else(|| BridgeError(format!("no document with handle {handle}")))
    }

    /// Closes a document and releases its pixels. Returns `false` for an unknown handle rather
    /// than failing: closing twice is not an error on the UI side.
    pub fn close(&mut self, handle: u64) -> bool {
        self.docs.remove(&handle).is_some()
    }

    /// Drops every document (process teardown, `JNI_OnUnload`).
    pub fn clear(&mut self) {
        self.docs.clear();
    }

    pub fn len(&self) -> usize {
        self.docs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }

    // ---------- creating and opening documents ----------

    /// File › New. `opts` is the `file.new` parameter object (width, height, mode, depth,
    /// background, resolution, name) passed straight to the engine command.
    pub fn new_document(&mut self, opts: &Value) -> BResult<u64> {
        let mut session = Session::new();
        let params = match opts {
            Value::Object(_) => opts.clone(),
            Value::Null => json!({}),
            other => return Err(BridgeError(format!("file.new options must be an object, got {other}"))),
        };
        session
            .execute("file.new", params)
            .map_err(|e| BridgeError(format!("could not create the document: {e}")))?;
        Ok(self.insert(OpenDocument::new(session)))
    }

    /// Opens bytes the app already has in memory (a content URI, a shared file, an asset).
    /// PSD/PSB, Affinity, camera raws and flat images are detected by magic, as on the desktop.
    pub fn open_bytes(&mut self, name: &str, bytes: &[u8]) -> BResult<u64> {
        let mut session = Session::new();
        if let Some(doc) = open_native(bytes) {
            session.add_document(doc, None);
            return Ok(self.insert(OpenDocument::new(session)));
        }
        let result = photocraft_io::import(name, bytes).map_err(|e| BridgeError(format!("could not open {name}: {e}")))?;
        if result.preview_only {
            return Err(BridgeError(format!(
                "{} is only previewable ({})",
                name,
                result.warnings.first().cloned().unwrap_or_else(|| "its native data could not be read".into())
            )));
        }
        session.add_document(result.document, None);
        let mut open = OpenDocument::new(session);
        open.warnings = result.warnings;
        open.read_only_source = result.source_read_only;
        Ok(self.insert(open))
    }

    /// Opens a file by path (used for `file.open` / `file.placeEmbedded` targets inside the app's
    /// private storage, and for autosave recovery).
    pub fn open_path(&mut self, path: &str) -> BResult<u64> {
        let bytes = std::fs::read(Path::new(path)).map_err(|e| BridgeError(format!("could not read {path}: {e}")))?;
        let name = Path::new(path).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string());
        let handle = self.open_bytes(&name, &bytes)?;
        self.get_mut(handle)?.session.active_mut().ok_or_else(|| BridgeError("no document open".into()))?.path = Some(path.to_string());
        Ok(handle)
    }

    // ---------- commands, history ----------

    /// Runs any engine command by id with JSON parameters. This is the single door the app uses
    /// for editing, so the whole command registry (layers, type, transforms, adjustments,
    /// `layer.removeBackground`, …) is available on Android without a second implementation.
    pub fn execute(&mut self, handle: u64, command: &str, params: &Value) -> BResult<Value> {
        if command.trim().is_empty() {
            return Err(BridgeError("empty command id".into()));
        }
        let open = self.get_mut(handle)?;
        open.session.execute(command, params.clone()).map_err(|e| BridgeError(format!("{command}: {e}")))
    }

    /// Whether a command can run right now (drives enabled/disabled UI state).
    pub fn is_enabled(&self, handle: u64, command: &str) -> bool {
        self.get(handle).map(|o| o.session.is_enabled(command)).unwrap_or(false)
    }

    /// Why a command is disabled, for a snackbar.
    pub fn disabled_reason(&self, handle: u64, command: &str) -> Option<String> {
        self.get(handle).ok().and_then(|o| o.session.disabled_reason(command))
    }

    pub fn undo(&mut self, handle: u64) -> BResult<bool> {
        Ok(self.get_mut(handle)?.session.undo())
    }

    pub fn redo(&mut self, handle: u64) -> BResult<bool> {
        Ok(self.get_mut(handle)?.session.redo())
    }

    // ---------- analysis ----------

    /// Everything the editor's layers panel and top bar show, as one JSON object.
    pub fn document_info(&self, handle: u64) -> BResult<Value> {
        let open = self.get(handle)?;
        let st = open.session.active().ok_or_else(|| BridgeError("no document open".into()))?;
        let doc = &st.doc;
        let layers: Vec<Value> = doc
            .walk()
            .into_iter()
            .map(|(_, depth, l)| {
                json!({
                    "id": l.id.0,
                    "name": l.name,
                    "visible": l.visible,
                    "opacity": l.opacity,
                    "fill": l.fill_opacity,
                    "blend": format!("{:?}", l.blend),
                    "kind": l.content.kind_name(),
                    "hasMask": l.mask.is_some(),
                    "maskEnabled": l.mask.as_ref().map(|m| m.enabled).unwrap_or(false),
                    "clipped": l.clipped,
                    "locked": l.locks.all || l.locks.pixels,
                    "depth": depth,
                })
            })
            .collect();
        Ok(json!({
            "name": doc.name,
            "width": doc.size.width,
            "height": doc.size.height,
            "mode": format!("{:?}", doc.mode).to_lowercase(),
            "depth": match doc.depth { photocraft_color::SampleType::U8 => 8, photocraft_color::SampleType::U16 => 16, _ => 32 },
            "resolution": doc.resolution_dpi,
            "revision": st.revision,
            "dirty": st.is_dirty(),
            "canUndo": st.history.can_undo(),
            "canRedo": st.history.can_redo(),
            "activeLayer": st.active_layer.map(|id| id.0),
            "selectedLayers": st.selected_layers.iter().map(|id| id.0).collect::<Vec<_>>(),
            "path": st.path,
            "readOnlySource": open.read_only_source,
            "layerCount": layers.len(),
            "layers": layers,
        }))
    }

    // ---------- rendering ----------

    /// Composites the document at `max_side` (never upscales) and returns straight-alpha
    /// `0xAARRGGBB` words, ready for `android.graphics.Bitmap.setPixels`.
    ///
    /// The composite is produced by the real CPU compositor at reduced resolution, so a 48 MP
    /// photo never allocates a full-resolution float buffer just to show it on a phone screen.
    pub fn render_argb(&self, handle: u64, max_side: u32) -> BResult<RenderedImage> {
        let open = self.get(handle)?;
        let doc = open.session.active().ok_or_else(|| BridgeError("no document open".into()))?.doc.clone();
        let max_side = max_side.clamp(1, 16_384);
        let (w, h) = (doc.size.width.max(1), doc.size.height.max(1));
        let scale = (max_side as f32 / w.max(h) as f32).min(1.0);
        let tw = (w as f32 * scale).round().max(1.0) as u32;
        let th = (h as f32 * scale).round().max(1.0) as u32;
        let buffer = photocraft_compose::render_reduced(&doc, tw, th);
        let rgba = buffer.to_rgba8();
        Ok(RenderedImage::from_rgba(rgba.width, rgba.height, &rgba.pixels))
    }

    /// A thumbnail for the home screen's recent-project cards (written to a PNG by the app).
    pub fn thumbnail(&self, handle: u64, max_side: u32) -> BResult<RenderedImage> {
        self.render_argb(handle, max_side.clamp(16, 1024))
    }

    // ---------- saving and exporting ----------

    /// Saves the native, layered `.pcraft` document. Reopening these bytes restores every layer,
    /// mask, effect and the history-independent layer ids — this is the app's project format.
    pub fn save_pcraft(&self, handle: u64) -> BResult<Vec<u8>> {
        let open = self.get(handle)?;
        let doc = open.session.active().ok_or_else(|| BridgeError("no document open".into()))?.doc.clone();
        let opts = photocraft_format::SaveOptions::default();
        photocraft_format::save_to_bytes(&doc, &opts).map_err(|e| BridgeError(format!("could not save: {e}")))
    }

    /// Exports a flat file (`png`, `jpg`, `webp`, `tif`, `psd`, `pcraft`, …) through
    /// `photocraft-io`. Exporting never touches the open document: the engine only reads it.
    pub fn export(&self, handle: u64, name_or_ext: &str, options: &Value) -> BResult<Vec<u8>> {
        let open = self.get(handle)?;
        let doc = open.session.active().ok_or_else(|| BridgeError("no document open".into()))?.doc.clone();
        let opts = export_options(options)?;
        let result = photocraft_io::export(&doc, name_or_ext, &opts)
            .map_err(|e| BridgeError(format!("could not export {name_or_ext}: {e}")))?;
        Ok(result.bytes)
    }

    /// Exports a *scaled copy* without resizing the document the user is editing: the document is
    /// duplicated and `image.imageSize` is applied to the copy inside a throwaway session.
    pub fn export_scaled(&self, handle: u64, name_or_ext: &str, width: u32, height: u32, options: &Value) -> BResult<Vec<u8>> {
        let open = self.get(handle)?;
        let doc = open.session.active().ok_or_else(|| BridgeError("no document open".into()))?.doc.clone();
        if width == 0 || height == 0 || width > 65_535 || height > 65_535 {
            return Err(BridgeError(format!("export size {width}x{height} is out of range")));
        }
        let mut scratch = Session::new();
        scratch.add_document((*doc).clone(), None);
        if (width, height) != (doc.size.width, doc.size.height) {
            scratch
                .execute("image.imageSize", json!({ "width": width, "height": height }))
                .map_err(|e| BridgeError(format!("could not resize the export copy: {e}")))?;
        }
        let opts = export_options(options)?;
        let exported = photocraft_io::export(scratch.active().ok_or_else(|| BridgeError("no document open".into()))?.doc.as_ref(), name_or_ext, &opts)
            .map_err(|e| BridgeError(format!("could not export {name_or_ext}: {e}")))?;
        Ok(exported.bytes)
    }

    // ---------- model-driven background removal ----------

    /// Applies a grayscale alpha mask produced by an ONNX model (or any other source) to a layer
    /// as a **non-destructive layer mask**, in one history step: undo and redo work, the pixels
    /// are untouched, and the document stays a layered document.
    ///
    /// `mask` is one byte per pixel (0 = hide, 255 = reveal) in `w`×`h`, in *document* pixel
    /// coordinates; the caller is responsible for resizing its model output back to the document
    /// size (see `BackgroundRemover` in the Kotlin app, which reverses the letterbox padding).
    pub fn apply_alpha_mask(&mut self, handle: u64, layer_id: u64, mask: &[u8], w: u32, h: u32, label: &str) -> BResult<bool> {
        let w = w.clamp(1, 65_535);
        let h = h.clamp(1, 65_535);
        let need = (w as usize).saturating_mul(h as usize);
        if mask.len() < need {
            return Err(BridgeError(format!("mask is {} bytes, expected {w}x{h} = {need}", mask.len())));
        }
        let open = self.get_mut(handle)?;
        let id = LayerId(layer_id);
        let surface = Surface::from_interleaved(PixelFormat::GRAY8, Rect::new(0, 0, w as i32, h as i32), &mask[..need]);
        let label = if label.trim().is_empty() { "Remove Background" } else { label };
        open.session
            .edit(label, |doc, _| {
                let layer = doc.layer_mut(id).ok_or(photocraft_engine::EngineError::NoLayer(id))?;
                if !matches!(layer.content, photocraft_doc::LayerContent::Raster(_)) {
                    return Err(photocraft_engine::EngineError::Other(format!(
                        "the layer is {} {} layer, not a pixel layer",
                        layer.content.article(),
                        layer.content.kind_name()
                    )));
                }
                if doc.effective_locks(id).pixels || doc.effective_locks(id).all {
                    return Err(photocraft_engine::EngineError::Other(format!(
                        "Could not complete your request because the layer \"{}\" is locked",
                        layer.name
                    )));
                }
                // A mask needs an unlocked, non-Background layer, exactly like the desktop's
                // Remove Background quick action.
                crate::promote_background(doc, id);
                let layer = doc.layer_mut(id).ok_or(photocraft_engine::EngineError::NoLayer(id))?;
                layer.mask = Some(LayerMask { surface, ..LayerMask::reveal_all() });
                Ok(true)
            })
            .map_err(|e| BridgeError(format!("could not apply the mask: {e}")))
    }
}

/// A `.pcraft` signature test: the app stores projects in its own format and must open them with
/// the native loader (which keeps layers) rather than the flat importer.
fn open_native(bytes: &[u8]) -> Option<Document> {
    if !photocraft_format::is_pcraft(bytes) {
        return None;
    }
    photocraft_format::load_from_bytes(bytes).ok()
}

/// Turns the Background layer into a normal layer so it can carry a mask (mirrors
/// `extra_cmds::background_to_layer_for_mask` on the desktop, reimplemented here so the bridge
/// does not depend on a private engine module).
pub fn promote_background(doc: &mut Document, id: LayerId) {
    let Some(layer) = doc.layer(id) else { return };
    if !matches!(layer.content, photocraft_doc::LayerContent::Raster(_)) || !layer.name.eq("Background") {
        return;
    }
    if let Some(layer) = doc.layer_mut(id) {
        layer.name = doc.next_layer_name("Layer");
        layer.locks.transparency = false;
        layer.locks.position = false;
    }
}

fn export_options(options: &Value) -> BResult<photocraft_io::ExportOptions> {
    let mut opts = photocraft_io::ExportOptions::default();
    if let Value::Object(map) = options {
        if let Some(q) = map.get("jpegQuality").and_then(Value::as_u64) {
            opts.encode.jpeg_quality = q.clamp(1, 100) as u8;
        }
        if let Some(q) = map.get("webpQuality").and_then(Value::as_u64) {
            opts.encode.webp_quality = q.clamp(1, 100) as u8;
        }
        if let Some(v) = map.get("webpLossless").and_then(Value::as_bool) {
            opts.encode.webp_lossless = v;
        }
        if let Some(v) = map.get("embedMetadata").and_then(Value::as_bool) {
            opts.encode.embed_metadata = v;
        }
        if let Some(v) = map.get("embedIcc").and_then(Value::as_bool) {
            opts.encode.embed_icc = v;
        }
        if let Some(v) = map.get("tiffLayers").and_then(Value::as_bool) {
            opts.tiff_layers = v;
        }
        if let Some(v) = map.get("xmp").and_then(Value::as_str) {
            opts.xmp = if v.eq_ignore_ascii_case("none") { photocraft_io::XmpEmbed::None } else { photocraft_io::XmpEmbed::All };
        }
    }
    Ok(opts)
}

/// A composite ready for `Bitmap.setPixels`: width, height and `0xAARRGGBB` words.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedImage {
    pub width: u32,
    pub height: u32,
    /// `width * height` pixels, straight (non-premultiplied) alpha.
    pub argb: Vec<i32>,
}

impl RenderedImage {
    pub fn from_rgba(width: u32, height: u32, rgba: &[u8]) -> Self {
        let n = (width as usize).saturating_mul(height as usize);
        let mut argb = Vec::with_capacity(n);
        for chunk in rgba.chunks_exact(4).take(n) {
            let (r, g, b, a) = (chunk[0] as i32, chunk[1] as i32, chunk[2] as i32, chunk[3] as i32);
            argb.push((a << 24) | (r << 16) | (g << 8) | b);
        }
        argb.resize(n, 0);
        Self { width, height, argb }
    }

    /// The JNI wire format: `[width, height, pixels…]` as one `int[]`.
    pub fn to_int_array(&self) -> Vec<i32> {
        let mut out = Vec::with_capacity(self.argb.len().saturating_add(2));
        out.push(self.width as i32);
        out.push(self.height as i32);
        out.extend_from_slice(&self.argb);
        out
    }
}
