/**
 * Background Removal — local BiRefNet Lite matting (ONNX Runtime, on-device)
 * plus the engine's own algorithmic Select Subject. The AI matte lands in the
 * document as REAL content: the cutout is written to a PNG by the native side,
 * placed through the engine (`file.placeEmbedded`), and its alpha becomes an
 * editable layer mask (`layer.layerMask.fromTransparency`) — persistent,
 * undoable, PSD-exportable. Never a fake overlay.
 *
 * Modes: `quick` runs the network at 512² (fast preview), `hq` at the full
 * 1024². Refinement (threshold, edge smoothing, feather, shift-edge) is applied
 * to the raw matte before it ever reaches the document.
 */
import {BgRemoval, engineJson} from '../../native/PhotoCraftEngine';
import type {CutoutResult} from '../../native/PhotoCraftEngine';
import {Editor, getState} from '../DocumentStore';
import {tmpDir} from '../paths';

export interface MaskRefinement {
  /** Hard threshold on the matte before smoothing (0..1; 0 = off). */
  threshold?: number;
  /** Edge smoothing radius in matte pixels (0..8; 0 = off). */
  edgeSmooth?: number;
  /** Feather radius applied to the mask (0..8; 0 = off). */
  feather?: number;
  /** Shift the mask edge in/out (-1..1). */
  shiftEdge?: number;
}

export interface BgRemovalOptions extends MaskRefinement {
  mode: 'quick' | 'hq';
}

export interface BgRemovalResult {
  layerId: number;
  /** The layer owning the editable mask (same id — masks attach to layers). */
  maskLayerId: number | null;
  width: number;
  height: number;
  /** Where the refinement options actually applied. */
  mode: 'quick' | 'hq';
}


export const BackgroundRemoval = {
  async isReady(): Promise<boolean> {
    try {
      return await BgRemoval.isModelReady();
    } catch {
      return false;
    }
  },

  /**
   * AI cutout of an image → new layer above the active one with a real layer
   * mask derived from the matte's alpha. One undo step covers placement + mask.
   */
  async applyAiCutout(imageBase64: string, opts?: {mode?: 'quick' | 'hq'} & MaskRefinement): Promise<BgRemovalResult> {
    const mode = opts?.mode ?? 'hq';
    const path = `${tmpDir()}/cutout-${Date.now()}.png`;
    const cutout = await matte(imageBase64, {...opts, mode, saveAs: path});
    const reply = await Editor.runCommand('file.placeEmbedded', {path, fit: false});
    const placed = reply.layer as number | undefined;
    if (!placed) {
      throw new Error('placing the cutout failed');
    }
    // Alpha → real layer mask (the original pixels survive under the mask).
    const mask = await Editor.runCommand('layer.layerMask.fromTransparency', {layer: placed});
    return {
      layerId: placed,
      maskLayerId: (mask.layer ?? placed) as number,
      width: cutout.width,
      height: cutout.height,
      mode,
    };
  },

  /** Legacy entry points kept for the editor panel (quick/HQ). */
  async removeQuick(_layerId: number, imageBase64: string): Promise<BgRemovalResult> {
    return BackgroundRemoval.applyAiCutout(imageBase64, {mode: 'quick'});
  },

  async removeHQ(_layerId: number, imageBase64: string): Promise<BgRemovalResult> {
    return BackgroundRemoval.applyAiCutout(imageBase64, {mode: 'hq'});
  },

  /** Keep the original document untouched; add the cutout as its own layer. */
  async addAsLayer(imageBase64: string, name = 'Subject'): Promise<BgRemovalResult> {
    const result = await BackgroundRemoval.applyAiCutout(imageBase64, {mode: 'hq', edgeSmooth: 1});
    if (name !== 'Subject') {
      await Editor.runCommand('layer.setProps', {layer: result.layerId, name});
    }
    return result;
  },

  /**
   * Engine-native Select Subject on a pixel layer (no AI model needed):
   * `layer.removeBackground` — non-destructive mask with edge refinement,
   * exactly like Photoshop's Properties › Quick Actions.
   */
  async removeWithSelectSubject(layerId?: number, sampleAllLayers = false): Promise<{layer: number; bounds: [number, number, number, number]}> {
    const reply = await Editor.runCommand('layer.removeBackground', {layer: layerId, sampleAllLayers});
    return {layer: reply.layer, bounds: reply.bounds};
  },

  /** Grayscale matte preview (native, before any document change). */
  async previewMask(imageBase64: string, opts?: MaskRefinement & {mode?: 'quick' | 'hq'}): Promise<string> {
    const image = normalizeDataUrl(imageBase64);
    const data = await engineJson<{preview: string}>(
      (BgRemoval as any).mattePreview(image, JSON.stringify(opts ?? {})),
    );
    return data.preview;
  },

  /** Delete a layer's mask (`layer.layerMask.delete`). */
  async deleteMask(layerId: number) {
    await Editor.runCommand('layer.layerMask.delete', {layer: layerId});
  },

  /** Apply the mask into the pixels (destructive, like Photoshop). */
  async applyMask(layerId: number) {
    await Editor.runCommand('layer.layerMask.apply', {layer: layerId});
  },

  /** Enable/disable the mask without deleting it. */
  async setMaskEnabled(layerId: number, enabled: boolean) {
    await Editor.runCommand('layer.layerMask.enabled', {layer: layerId, enabled});
  },

  /** Link/unlink the mask from the layer. */
  async setMaskLinked(layerId: number, linked: boolean) {
    await Editor.runCommand('layer.layerMask.linked', {layer: layerId, linked});
  },

  /** Paint on the mask with white/black at a point (reveal/hide) — real pixels. */
  async paintMask(layerId: number, x: number, y: number, radius: number, reveal: boolean) {
    const {doc} = getState();
    if (!doc) {
      throw new Error('no document open');
    }
    const color = reveal ? '#ffffff' : '#000000';
    await Editor.runCommand('paint.stroke', {
      layer: layerId,
      target: 'mask',
      color,
      size: radius * 2,
      points: [[x, y]],
    });
  },
};

function normalizeDataUrl(imageBase64: string): string {
  return imageBase64.includes('base64,') ? imageBase64 : `data:image/png;base64,${imageBase64}`;
}

async function matte(
  imageBase64: string,
  opts: BgRemovalOptions & {saveAs?: string},
): Promise<CutoutResult & {savedAs?: string}> {
  const image = normalizeDataUrl(imageBase64);
  return engineJson<CutoutResult & {savedAs?: string}>(
    (BgRemoval as any).removeBackground(image, JSON.stringify({mode: opts.mode, threshold: opts.threshold ?? 0, edgeSmooth: opts.edgeSmooth ?? 1, feather: opts.feather ?? 0.6, shiftEdge: opts.shiftEdge ?? 0, saveAs: opts.saveAs})),
  );
}
