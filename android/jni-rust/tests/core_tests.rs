//! Host-side tests of the Android bridge's engine core.
//!
//! These run on the development machine (`cargo test -p photocraft-jni`) with no JVM and no
//! emulator, and they exercise exactly the code path the app uses: create → edit → render →
//! save → reopen → export → mask → undo. Every assertion below is about a *real* document
//! mutation, not about a mock.

use photocraft::core::Registry;
use serde_json::json;

fn new_doc(reg: &mut Registry, w: u32, h: u32, background: &str) -> u64 {
    reg.new_document(&json!({ "width": w, "height": h, "background": background, "name": "Test" }))
        .expect("file.new through the bridge")
}

fn layer_count(reg: &Registry, handle: u64) -> usize {
    let info = reg.document_info(handle).expect("document info");
    info["layers"].as_array().map(Vec::len).unwrap_or(0)
}

fn layers(reg: &Registry, handle: u64) -> serde_json::Value {
    reg.document_info(handle).expect("document info")["layers"].clone()
}

#[test]
fn new_document_creates_a_real_document() {
    let mut reg = Registry::new();
    let h = new_doc(&mut reg, 320, 200, "white");
    let info = reg.document_info(h).unwrap();
    assert_eq!(info["width"], 320);
    assert_eq!(info["height"], 200);
    assert_eq!(info["name"], "Test");
    assert_eq!(info["dirty"], false);
    assert_eq!(info["canUndo"], false);
    assert!(!info["activeLayer"].is_null());
}

#[test]
fn unknown_handles_and_bad_arguments_are_errors_not_panics() {
    let mut reg = Registry::new();
    assert!(reg.document_info(123).is_err());
    assert!(reg.execute(123, "layer.new.layer", &json!({})).is_err());
    assert!(reg.undo(123).is_err());
    assert!(reg.apply_alpha_mask(123, 1, &[0u8; 4], 2, 2, "mask").is_err());
    let h = new_doc(&mut reg, 8, 8, "white");
    assert!(reg.execute(h, "", &json!({})).is_err(), "an empty command id must not run");
    assert!(reg.execute(h, "no.such.command", &json!({})).is_err());
    assert!(reg.new_document(&json!(42)).is_err(), "file.new options must be an object");
}

#[test]
fn layer_commands_mutate_the_document_and_undo_and_redo_restore_it() {
    let mut reg = Registry::new();
    let h = new_doc(&mut reg, 64, 64, "white");
    let before = layer_count(&reg, h);

    reg.execute(h, "layer.new.layer", &json!({ "name": "Paint" })).expect("new layer");
    assert_eq!(layer_count(&reg, h), before + 1);
    assert_eq!(layers(&reg, h)[before]["name"], "Paint");

    reg.execute(h, "layer.setProps", &json!({ "opacity": 0.5, "visible": false })).unwrap();
    let top = layers(&reg, h)[before].clone();
    assert_eq!(top["opacity"], 0.5);
    assert_eq!(top["visible"], false);

    assert!(reg.undo(h).unwrap());
    assert_eq!(layers(&reg, h)[before]["opacity"], 1.0);
    assert!(reg.redo(h).unwrap());
    assert_eq!(layers(&reg, h)[before]["opacity"], 0.5);

    assert!(reg.undo(h).unwrap());
    assert!(reg.undo(h).unwrap());
    assert_eq!(layer_count(&reg, h), before, "both steps undone");
    assert!(reg.redo(h).unwrap());
    assert_eq!(layer_count(&reg, h), before + 1);
}

#[test]
fn render_produces_the_right_size_and_real_pixels() {
    let mut reg = Registry::new();
    let h = new_doc(&mut reg, 400, 200, "#ff0000");
    let img = reg.render_argb(h, 100).unwrap();
    // 400x200 scaled to a 100 px long side keeps the aspect ratio: no squeezing.
    assert_eq!((img.width, img.height), (100, 50));
    assert_eq!(img.argb.len(), 100 * 50);
    let centre = img.argb[(50 * 50) + 50];
    assert_eq!(centre, 0xFFFF_0000u32 as i32, "a red canvas renders red, opaque");

    // Never upscales.
    let small = reg.render_argb(h, 16).unwrap();
    assert_eq!((small.width, small.height), (16, 8));
}

#[test]
fn save_reload_round_trip_keeps_layers_and_pixels() {
    let mut reg = Registry::new();
    let h = new_doc(&mut reg, 120, 90, "#00ff00");
    reg.execute(h, "layer.new.layer", &json!({ "name": "Second" })).unwrap();
    let bytes = reg.save_pcraft(h).expect("save .pcraft");
    assert!(!bytes.is_empty());

    let reopened = reg.open_bytes("round-trip.pcraft", &bytes).expect("reopen .pcraft");
    let info = reg.document_info(reopened).unwrap();
    assert_eq!(info["width"], 120);
    assert_eq!(info["height"], 90);
    assert_eq!(layer_count(&reg, reopened), 2, "both layers survived the round trip");

    let img = reg.render_argb(reopened, 60).unwrap();
    assert_eq!(img.argb[0], 0xFF00_FF00, "the green background survived the round trip");
}

#[test]
fn export_writes_a_real_png_and_does_not_touch_the_document() {
    let mut reg = Registry::new();
    let h = new_doc(&mut reg, 200, 100, "#0000ff");
    let png = reg.export(h, "png", &json!({})).expect("export png");
    assert_eq!(&png[..4], &[0x89, b'P', b'N', b'G'], "a real PNG file");

    // Exporting at another size must not resize the document the user is editing.
    let scaled = reg.export_scaled(h, "png", 50, 25, &json!({})).expect("scaled export");
    let info = reg.document_info(h).unwrap();
    assert_eq!((info["width"], info["height"]), (200, 100), "the open document is untouched");

    let check = reg.open_bytes("scaled.png", &scaled).unwrap();
    let info = reg.document_info(check).unwrap();
    assert_eq!((info["width"], info["height"]), (50, 25), "the exported file is the requested size");

    let jpeg = reg.export(h, "jpg", &json!({ "jpegQuality": 80 })).expect("export jpeg");
    assert_eq!(&jpeg[..2], &[0xFF, 0xD8], "a real JPEG file");
}

#[test]
fn quick_remove_background_is_the_real_non_destructive_command() {
    let mut reg = Registry::new();
    // A subject (a bright disc) on a different background: the engine's own Select Subject has to
    // find something, or the command fails — which is the documented behaviour.
    let h = new_doc(&mut reg, 160, 160, "#204060");
    reg.execute(h, "layer.new.layer", &json!({ "name": "Subject" })).unwrap();
    // Fill the new layer's selection with a contrasting colour, then run the real command.
    // `select.rect` takes x/y/width/height (crates/engine/src/commands.rs), not [x, y, w, h].
    reg.execute(h, "select.rect", &json!({ "x": 40, "y": 40, "width": 80, "height": 80 })).unwrap();
    reg.execute(h, "edit.fill", &json!({ "contents": "color", "color": "#ff8800" })).unwrap();
    reg.execute(h, "select.deselect", &json!({})).unwrap();

    let result = reg.execute(h, "layer.removeBackground", &json!({ "sampleAllLayers": true }));
    assert!(result.is_ok(), "removeBackground should find a subject: {result:?}");
    let masked = layers(&reg, h).as_array().unwrap().iter().any(|l| l["hasMask"] == true);
    assert!(masked, "the command adds a layer mask (non-destructive)");

    assert!(reg.undo(h).unwrap());
    let still_masked = layers(&reg, h).as_array().unwrap().iter().any(|l| l["hasMask"] == true);
    assert!(!still_masked, "undo removes the mask");
    assert!(reg.redo(h).unwrap());
    let again = layers(&reg, h).as_array().unwrap().iter().any(|l| l["hasMask"] == true);
    assert!(again, "redo restores the mask");
}

#[test]
fn apply_alpha_mask_is_undoable_and_validates_its_input() {
    let mut reg = Registry::new();
    let h = new_doc(&mut reg, 32, 32, "white");
    let id = reg.document_info(h).unwrap()["activeLayer"].as_u64().unwrap();

    let mask = vec![255u8; 32 * 32];
    assert!(reg.apply_alpha_mask(h, id, &mask, 32, 32, "High quality remove").unwrap());
    assert_eq!(layers(&reg, h)[0]["hasMask"], true);
    assert!(reg.undo(h).unwrap());
    assert_eq!(layers(&reg, h)[0]["hasMask"], false, "undo removes the mask");
    assert!(reg.redo(h).unwrap());
    assert_eq!(layers(&reg, h)[0]["hasMask"], true);

    // Too small a mask is rejected instead of reading out of bounds.
    assert!(reg.apply_alpha_mask(h, id, &[0u8; 4], 32, 32, "short").is_err());
    // An unknown layer id is an error, not a panic.
    assert!(reg.apply_alpha_mask(h, 999_999, &mask, 32, 32, "missing layer").is_err());
}

#[test]
fn closing_releases_the_document() {
    let mut reg = Registry::new();
    let h = new_doc(&mut reg, 16, 16, "white");
    assert_eq!(reg.len(), 1);
    assert!(reg.close(h));
    assert!(!reg.close(h), "a second close is not an error");
    assert_eq!(reg.len(), 0);
    assert!(reg.document_info(h).is_err(), "a stale handle stays invalid");
}

#[test]
fn corrupt_bytes_fail_cleanly() {
    let mut reg = Registry::new();
    assert!(reg.open_bytes("broken.psd", b"not a picture at all").is_err());
    assert!(reg.open_bytes("empty.png", &[]).is_err());
    assert!(reg.open_path("/definitely/not/here.png").is_err());
}
