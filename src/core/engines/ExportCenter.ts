/**
 * Export Center — PNG, JPEG, WebP, PSD, PSB (plus .pcraft project files)
 * through the engine's codec stack. Quality control, size presets, social
 * presets, transparent PNG export, scale-on-export. Real encoder output
 * (photocraft-codecs + photocraft-io), saved into app storage.
 */
import {Engine, engineJson} from '../../native/PhotoCraftEngine';
import type {SmartPreset} from '../types';

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'psd' | 'psb' | 'pcraft';

export interface ExportOptions {
  format: ExportFormat;
  quality?: number; // JPEG/WebP 1..100
  transparent?: boolean; // PNG only (drops background layer visibility)
  scalePct?: number; // 10..400
  socialPreset?: SmartPreset | null;
}

export interface ExportResult {
  path: string;
  bytes: number;
  warnings: string[];
}

export const QUALITY_PRESETS = [
  {label: 'High', labelAr: 'عالية', value: 92},
  {label: 'Balanced', labelAr: 'متوازنة', value: 80},
  {label: 'Compact', labelAr: 'مضغوطة', value: 60},
];

export const ExportCenter = {
  /**
   * Export the active document.
   * PSD/PSB keep layers, masks, effects, text (TySh), groups — the real writers
   * from photocraft-psd/photocraft-io. Flat formats composite through the engine.
   */
  async export(sessionId: number, opts: ExportOptions): Promise<ExportResult> {
    const dir = '/data/data/com.photocraft.mobile/files/exports';
    const stamp = Date.now();
    const scale = opts.scalePct ?? 100;
    const name = `photocraft-${stamp}${opts.socialPreset ? `-${opts.socialPreset.id}` : ''}.${opts.format}`;
    const path = `${dir}/${name}`;

    // Optional scale + preset sizing happen as real canvas ops before the save,
    // so the exported pixels are exactly what the engine composited.
    if (opts.socialPreset) {
      await engineJson(
        Engine.execute(sessionId, 'image.resize', {
          width: opts.socialPreset.width,
          height: opts.socialPreset.height,
          anchor: 'center',
        }),
      );
    } else if (scale !== 100) {
      await engineJson(
        Engine.execute(sessionId, 'image.resize', {percent: scale, anchor: 'center'}),
      );
    }

    if (opts.transparent && (opts.format === 'png' || opts.format === 'webp')) {
      await engineJson(Engine.execute(sessionId, 'background.hide', {}));
    }

    const reply = await engineJson<{saved?: {bytes: number}; warnings?: string[]}>(
      Engine.saveDocument(sessionId, path, opts.format, opts.quality ?? 92),
    );

    return {
      path,
      bytes: reply.saved?.bytes ?? 0,
      warnings: reply.warnings ?? [],
    };
  },

  /** Social media presets wired to Smart Resize. */
  socialPresets: (): SmartPreset[] => require('../types').SMART_PRESETS,
};
