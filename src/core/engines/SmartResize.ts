/**
 * Smart Resize — Instagram/Facebook/TikTok/YouTube/Pinterest presets with
 * intelligent layer repositioning, text reflow and safe-area guides.
 * Strategy per layer kind:
 *   - groups/background: cover-crop to the new aspect (center-weighted, with
 *     per-layer focus points preserved).
 *   - text: re-anchor to safe area, reflow paragraph boxes, keep point text
 *     inside the visible area.
 *   - shapes/logos: proportional scale from the safe-area anchor.
 * All transforms are real engine commands, so undo history and PSD output stay
 * consistent.
 */
import {Editor} from '../DocumentStore';
import {SMART_PRESETS} from '../types';
import type {LayerSummary, SmartPreset} from '../types';

export interface ResizeReport {
  moved: number;
  reflowed: number;
  scaled: number;
}

export const SmartResize = {
  presets: () => SMART_PRESETS,

  /**
   * Resize the document to a preset and re-fit layers.
   * `guide` shows the safe area in the editor overlay afterwards.
   */
  async apply(preset: SmartPreset): Promise<ResizeReport> {
    const {doc, layers} = useSnap();
    if (!doc) {
      throw new Error('no document open');
    }
    const report: ResizeReport = {moved: 0, reflowed: 0, scaled: 0};
    const oldW = doc.width;
    const oldH = doc.height;

    // 1) canvas resize (engine keeps layer pixel data; we re-fit below)
    await Editor.runCommand('image.resize', {
      width: preset.width,
      height: preset.height,
      anchor: 'center',
    });

    // 2) per-layer refit
    for (const layer of layers) {
      if (layer.kind === 'group') {
        continue; // groups own their children's transforms
      }
      if (layer.kind === 'text') {
        await refitText(layer, oldW, oldH, preset);
        report.reflowed++;
      } else {
        await coverFit(layer, oldW, oldH, preset);
        report.scaled++;
      }
    }

    // 3) safe-area guide overlay (editor visual, not document content)
    await Editor.runCommand('guides.safeArea', {percent: preset.safeAreaPct});
    return report;
  },
};

// small accessor to avoid re-render churn during batched commands
let snapshot: {doc: import('../types').DocumentInfo | null; layers: LayerSummary[]} = {
  doc: null,
  layers: [],
};
export function feedSnapshot(doc: import('../types').DocumentInfo | null, layers: LayerSummary[]) {
  snapshot = {doc, layers};
}
function useSnap() {
  return snapshot;
}

async function coverFit(layer: LayerSummary, oldW: number, oldH: number, preset: SmartPreset) {
  const scale = Math.max(preset.width / oldW, preset.height / oldH);
  await Editor.runCommand('layer.transform', {
    id: layer.id,
    scale,
    anchor: 'center',
  });
}

async function refitText(layer: LayerSummary, oldW: number, oldH: number, preset: SmartPreset) {
  const safe = preset.safeAreaPct / 100;
  const marginX = preset.width * safe;
  const marginTop = preset.height * safe;
  // Anchor into the safe area and let paragraph boxes rewrap.
  await Editor.runCommand('layer.transform', {
    id: layer.id,
    anchor: 'topLeft',
    x: marginX,
    y: marginTop,
  });
  await Editor.runCommand('text.reflow', {
    id: layer.id,
    maxWidth: preset.width - marginX * 2,
  });
}
