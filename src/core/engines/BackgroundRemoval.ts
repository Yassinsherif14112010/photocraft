/**
 * Background Removal — local BiRefNet Lite matting (ONNX Runtime, on-device).
 * Quick (preview) and HQ (full 1024²) passes, output becomes a real raster
 * layer + layer mask through the engine, so it persists to PSD/PSB and is
 * fully undoable. Never a fake overlay.
 */
import {BgRemoval, engineJson} from '../../native/PhotoCraftEngine';
import type {CutoutResult} from '../../native/PhotoCraftEngine';
import {Editor} from '../DocumentStore';

export interface BgRemovalResult {
  layerId: number;
  maskLayerId: number | null;
  width: number;
  height: number;
}

export const BackgroundRemoval = {
  async isReady(): Promise<boolean> {
    try {
      return await BgRemoval.isModelReady();
    } catch {
      return false;
    }
  },

  /** One-shot cutout: replaces the active layer's pixels with the matted RGBA. */
  async removeQuick(layerId: number, imageBase64: string): Promise<BgRemovalResult> {
    return run(layerId, imageBase64, 'quick');
  },

  async removeHQ(layerId: number, imageBase64: string): Promise<BgRemovalResult> {
    return run(layerId, imageBase64, 'hq');
  },

  /** Keep the original layer; add the cutout as a separate raster layer. */
  async addAsLayer(imageBase64: string, name = 'Subject'): Promise<BgRemovalResult> {
    const cutout = await matte(imageBase64, 'hq');
    const reply = await Editor.runCommand('layer.addRaster', {
      name,
      width: cutout.width,
      height: cutout.height,
      rgba: cutout.rgba, // engine decodes + tiles it into the document
    });
    return {layerId: reply.id, maskLayerId: null, width: cutout.width, height: cutout.height};
  },
};

async function matte(imageBase64: string, mode: 'quick' | 'hq'): Promise<CutoutResult> {
  const image = imageBase64.includes('base64,') ? imageBase64 : `data:image/png;base64,${imageBase64}`;
  return mode === 'hq'
    ? engineJson<CutoutResult>(BgRemoval.removeBackgroundHQ(image))
    : engineJson<CutoutResult>(BgRemoval.removeBackgroundQuick(image));
}

async function run(
  layerId: number,
  imageBase64: string,
  mode: 'quick' | 'hq',
): Promise<BgRemovalResult> {
  const cutout = await matte(imageBase64, mode);
  // 1) write the matted pixels into the layer
  const reply = await Editor.runCommand('layer.setRgba', {
    id: layerId,
    width: cutout.width,
    height: cutout.height,
    rgba: cutout.rgba,
  });
  // 2) derive a layer mask from the alpha so the original pixels survive
  const mask = await Editor.runCommand('mask.fromAlpha', {id: layerId});
  return {
    layerId: reply.id ?? layerId,
    maskLayerId: mask.maskId ?? null,
    width: cutout.width,
    height: cutout.height,
  };
}
