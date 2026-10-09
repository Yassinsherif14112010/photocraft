/**
 * Export Center — PNG, JPEG, WebP, PSD, PSB (plus .pcraft project files)
 * through the engine's real writers (photocraft-codecs / photocraft-io via
 * `doc.save`). Export presets, named profiles, transparency (the background
 * layer is toggled through real `layer.setProps` visibility), quality and
 * resample controls, document metadata (`file.fileInfo`) and batch exports.
 */
import {Engine, engineJson, FileIO} from '../../native/PhotoCraftEngine';
import {getState} from '../DocumentStore';
import {exportsDir, tmpDir} from '../paths';
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

const EXPORTS_DIR = () => exportsDir();

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
    const path = `${EXPORTS_DIR()}/${name}`;

    const needsScale =
      !!opts.socialPreset ||
      (opts.scalePct !== undefined && opts.scalePct !== 100 && !!getState().doc);

    /**
     * Scale-on-export must NEVER resample the live document: the working copy
     * would come back resized on the next autosave. Instead the current state
     * is snapshotted to a temp .pcraft, opened in its own engine session,
     * resized there, exported, and the temp session + file are released.
     */
    let exportSessionId = sessionId;
    let tempPath: string | null = null;
    try {
      if (needsScale) {
        tempPath = `${tmpDir()}/export-${stamp}.pcraft`;
        const snap = await Engine.saveDocument(sessionId, tempPath, 'pcraft', 100);
        if ((snap as {error?: string}).error) {
          throw new Error((snap as {error?: string}).error);
        }
        const opened = await Engine.engineCommands();
        exportSessionId = opened.sessionId;
        await engineJson(Engine.openDocument(exportSessionId, tempPath));

        if (opts.socialPreset) {
          await engineJson(
            Engine.execute(exportSessionId, 'image.imageSize', {
              width: opts.socialPreset.width,
              height: opts.socialPreset.height,
              resample: opts.resample ?? 'bicubic',
            }),
          );
        } else {
          const {doc} = getState();
          await engineJson(
            Engine.execute(exportSessionId, 'image.imageSize', {
              width: Math.max(1, Math.round(((doc?.width ?? 0) * (opts.scalePct ?? 100)) / 100)),
              height: Math.max(1, Math.round(((doc?.height ?? 0) * (opts.scalePct ?? 100)) / 100)),
              resample: opts.resample ?? 'bicubic',
            }),
          );
        }
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
        const reply = await engineJson<{warnings?: string[]}>(
          Engine.saveDocument(exportSessionId, path, opts.format, opts.quality ?? 92),
        );
        // Verify the output really exists and is not empty — a 0-byte file or a
        // missing file is an export failure, never a success with a bad path.
        const stat = await Engine.fileSize(path);
        if (stat == null || stat <= 0) {
          throw new Error(`export produced no file (${stat} bytes): ${path}`);
        }
        result = {
          path,
          bytes: stat,
          warnings: reply.warnings ?? [],
        };
      } finally {
        if (hid != null) {
          await engineJson(Engine.execute(sessionId, 'layer.setProps', {layer: hid, visible: true, coalesce: true}));
        }
      }
      return result;
    } finally {
      if (exportSessionId !== sessionId) {
        await Engine.closeSession(exportSessionId).catch(() => {});
      }
      if (tempPath) {
        await FileIO?.deleteFile(tempPath).catch(() => {});
      }
    }
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
