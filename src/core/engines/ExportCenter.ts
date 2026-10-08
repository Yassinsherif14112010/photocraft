/**
 * Export Center — PNG, JPEG, WebP, PSD, PSB (plus .pcraft project files)
 * through the engine's real writers (photocraft-codecs / photocraft-io via
 * `doc.save`). Export presets, named profiles, transparency (the background
 * layer is toggled through real `layer.setProps` visibility), quality and
 * resample controls, document metadata (`file.fileInfo`) and batch exports.
 */
import {Engine, engineJson} from '../../native/PhotoCraftEngine';
import {getState} from '../DocumentStore';
import type {SmartPreset} from '../types';

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'psd' | 'psb' | 'pcraft';

export interface ExportOptions {
  format: ExportFormat;
  quality?: number; // JPEG/WebP 1..100
  transparent?: boolean; // PNG/WebP: hide the background layer for the write
  scalePct?: number; // 10..400
  socialPreset?: SmartPreset | null;
  /** Interpolation for scale-on-export (engine resample names). */
  resample?: 'bicubic' | 'bilinear' | 'nearest' | 'lanczos' | 'preserveDetails';
}

export interface ExportResult {
  path: string;
  bytes: number;
  warnings: string[];
}

export interface ExportProfile {
  id: string;
  name: string;
  nameAr: string;
  opts: ExportOptions;
}

export const QUALITY_PRESETS = [
  {label: 'High', labelAr: 'عالية', value: 92},
  {label: 'Balanced', labelAr: 'متوازنة', value: 80},
  {label: 'Compact', labelAr: 'مضغوطة', value: 60},
];

export const EXPORT_PROFILES: ExportProfile[] = [
  {id: 'web-png', name: 'Web PNG', nameAr: 'ويب PNG', opts: {format: 'png', quality: 92, transparent: true, scalePct: 100}},
  {id: 'web-jpg', name: 'Web JPEG', nameAr: 'ويب JPEG', opts: {format: 'jpg', quality: 80, scalePct: 100}},
  {id: 'webp-compact', name: 'Compact WebP', nameAr: 'ويب بي مضغوط', opts: {format: 'webp', quality: 60, scalePct: 100}},
  {id: 'master-psd', name: 'Master PSD', nameAr: 'ملف PSD رئيسي', opts: {format: 'psd', quality: 100, scalePct: 100}},
  {id: 'big-psb', name: 'Large PSB', nameAr: 'ملف PSB كبير', opts: {format: 'psb', quality: 100, scalePct: 100}},
];

const EXPORTS_DIR = '/data/data/com.photocraft.mobile/files/exports';

export const ExportCenter = {
  /**
   * Export the active document. PSD/PSB keep layers, masks, effects, text
   * (TySh), groups — the real writers from photocraft-psd/photocraft-io.
   * Flat formats composite through the engine. Transparency works by toggling
   * the background layer's real visibility for the write, then restoring it.
   */
  async export(sessionId: number, opts: ExportOptions): Promise<ExportResult> {
    const stamp = Date.now();
    const name = `photocraft-${stamp}${opts.socialPreset ? `-${opts.socialPreset.id}` : ''}.${opts.format}`;
    const path = `${EXPORTS_DIR}/${name}`;

    // Optional preset/scale sizing happens as a real `image.imageSize` resample,
    // so the exported pixels are exactly what the engine composited.
    const {doc} = getState();
    if (opts.socialPreset) {
      await engineJson(
        Engine.execute(sessionId, 'image.imageSize', {
          width: opts.socialPreset.width,
          height: opts.socialPreset.height,
          resample: opts.resample ?? 'bicubic',
        }),
      );
    } else if (opts.scalePct !== undefined && opts.scalePct !== 100 && doc) {
      await engineJson(
        Engine.execute(sessionId, 'image.imageSize', {
          width: Math.max(1, Math.round((doc.width * opts.scalePct) / 100)),
          height: Math.max(1, Math.round((doc.height * opts.scalePct) / 100)),
          resample: opts.resample ?? 'bicubic',
        }),
      );
    }

    // Transparency: hide the bottom (background) layer for the write, then restore.
    const hid: number | null = opts.transparent && (opts.format === 'png' || opts.format === 'webp')
      ? backgroundLayerId()
      : null;
    if (hid != null) {
      await engineJson(Engine.execute(sessionId, 'layer.setProps', {layer: hid, visible: false, coalesce: true}));
    }

    let result: ExportResult;
    try {
      const reply = await engineJson<{saved?: {bytes: number}; warnings?: string[]}>(
        Engine.saveDocument(sessionId, path, opts.format, opts.quality ?? 92),
      );
      result = {
        path,
        bytes: reply.saved?.bytes ?? 0,
        warnings: reply.warnings ?? [],
      };
    } finally {
      if (hid != null) {
        await engineJson(Engine.execute(sessionId, 'layer.setProps', {layer: hid, visible: true, coalesce: true}));
      }
    }
    return result;
  },

  /**
   * Batch export: every format/quality pair in one pass (the document is
   * exported repeatedly from its current state).
   */
  async batch(sessionId: number, jobs: ExportOptions[]): Promise<ExportResult[]> {
    const results: ExportResult[] = [];
    for (const job of jobs) {
      results.push(await ExportCenter.export(sessionId, job));
    }
    return results;
  },

  /** Write document metadata (persists into PSD/XMP via `file.fileInfo`). */
  async setMetadata(sessionId: number, meta: {title?: string; author?: string; description?: string; keywords?: string[]; copyright?: string}) {
    await engineJson(Engine.execute(sessionId, 'file.fileInfo', meta));
  },

  async getMetadata(sessionId: number) {
    const reply = await engineJson<{fileInfo?: Record<string, unknown>}>(Engine.execute(sessionId, 'file.fileInfo', {}));
    return reply.fileInfo ?? reply;
  },

  /** Social media presets wired to Smart Resize. */
  socialPresets: (): SmartPreset[] => require('../types').SMART_PRESETS,

  /** Export profile registry (named option bundles). */
  profiles: (): ExportProfile[] => EXPORT_PROFILES,
};

/** Bottom-most top-level layer — the canvas background ("Background"/Layer 0). */
function backgroundLayerId(): number | null {
  const {layers} = getState();
  const bottom = layers[layers.length - 1];
  return bottom ? bottom.id : null;
}
