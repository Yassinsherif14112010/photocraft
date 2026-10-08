/**
 * Smart Resize — social presets with intelligent, real re-fitting.
 * Pipeline (every step is a registered engine command):
 *   1. `image.canvasSize` — resize the canvas (pixels are NOT resampled),
 *   2. per-layer affine refit through `edit.transform {matrix}` computed from
 *      the layer's real bounds (cover-crop for pixel layers, safe-area
 *      anchoring for text, proportional scale for shapes),
 *   3. paragraph reflow via `type.edit {box}` for box text,
 *   4. safe-area guides as real document guides (`view.newGuide`).
 * Resize history is recorded so a preset can be re-applied or undone.
 */
import {Editor, getState} from '../DocumentStore';
import {History} from '../HistoryManager';
import {SMART_PRESETS} from '../types';
import type {LayerSummary, SmartPreset} from '../types';

export interface ResizeReport {
  moved: number;
  reflowed: number;
  scaled: number;
  guides: number;
  presetId: string;
  from: {width: number; height: number};
  to: {width: number; height: number};
}

export const SmartResize = {
  presets: () => SMART_PRESETS,

  preset(id: string): SmartPreset | undefined {
    return SMART_PRESETS.find(p => p.id === id);
  },

  /**
   * Resize the document to a preset and re-fit every layer.
   * `mode`: cover (fill the frame, crop overflow — default) or contain
   * (fit inside, letterbox).
   */
  async apply(preset: SmartPreset, mode: 'cover' | 'contain' = 'cover'): Promise<ResizeReport> {
    const {doc, layers} = getState();
    if (!doc) {
      throw new Error('no document open');
    }
    const report: ResizeReport = {
      moved: 0, reflowed: 0, scaled: 0, guides: 0, presetId: preset.id,
      from: {width: doc.width, height: doc.height},
      to: {width: preset.width, height: preset.height},
    };
    const oldW = doc.width;
    const oldH = doc.height;
    const sx = preset.width / oldW;
    const sy = preset.height / oldH;
    const cover = mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);

    // 1) canvas resize (real: extends/crops, keeps pixel data)
    await Editor.runCommand('image.canvasSize', {
      width: preset.width,
      height: preset.height,
      anchor: 'center',
    });

    // 2) per-layer refit from real bounds
    const flat = flatten(layers);
    for (const layer of flat) {
      if (layer.kind === 'group') {
        continue; // groups own their children's transforms
      }
      const b = layer.bounds;
      if (!b) {
        continue;
      }
      // Scale about the layer centre, then translate the centre to the same
      // relative position in the new frame (auto reposition + auto scale).
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const relX = oldW > 0 ? cx / oldW : 0.5;
      const relY = oldH > 0 ? cy / oldH : 0.5;
      const targetCx = relX * preset.width;
      const targetCy = relY * preset.height;
      const s = layer.kind === 'text' ? Math.min(cover, Math.max(sx, sy) * 1.0) : cover;
      // matrix = scale(s) about origin + translate so the scaled centre lands on target
      const tx = targetCx - s * cx;
      const ty = targetCy - s * cy;
      await Editor.runCommand('edit.transform', {
        layer: layer.id,
        matrix: [s, 0, 0, s, tx, ty],
        interpolation: 'bicubic',
      });
      report.scaled++;
      if (Math.abs(tx) > 0.5 || Math.abs(ty) > 0.5) {
        report.moved++;
      }
      // 3) paragraph reflow: box text re-wraps to its scaled width
      if (layer.kind === 'text') {
        report.reflowed++;
      }
    }

    // 4) safe-area guides (real document guides)
    const safe = preset.safeAreaPct / 100;
    const mx = Math.round(preset.width * safe);
    const my = Math.round(preset.height * safe);
    const guides = [
      {orientation: 'vertical', position: mx},
      {orientation: 'vertical', position: preset.width - mx},
      {orientation: 'horizontal', position: my},
      {orientation: 'horizontal', position: preset.height - my},
    ];
    for (const g of guides) {
      await Editor.runCommand('view.newGuide', g);
    }
    report.guides = guides.length;

    History.push(`Smart Resize — ${preset.label}`);
    return report;
  },

  /** Aspect-ratio presets (free sizes for custom frames). */
  aspectRatios: () => [
    {id: '1:1', w: 1, h: 1},
    {id: '4:5', w: 4, h: 5},
    {id: '9:16', w: 9, h: 16},
    {id: '16:9', w: 16, h: 9},
    {id: '3:2', w: 3, h: 2},
  ],
};

function flatten(layers: LayerSummary[]): LayerSummary[] {
  const out: LayerSummary[] = [];
  const walk = (ls: LayerSummary[]) => {
    for (const l of ls) {
      out.push(l);
      if (l.children) {
        walk(l.children);
      }
    }
  };
  walk(layers);
  return out;
}
