/**
 * Text Studio — Text Layers, point & paragraph text, RTL (Arabic + English),
 * kerning/tracking/leading, character & paragraph styles, font manager,
 * variable-font axis pass-through, text transform, and text metadata
 * persistence. All shaping/layout happens in the vendored `photocraft-text`
 * crate (HarfBuzz-grade shaper upstream) via the engine's `text.*` commands.
 */
import {Editor} from '../DocumentStore';
import type {OcrMetadata, TextRunSpec} from '../types';

export interface AddTextOptions {
  text: string;
  x: number;
  y: number;
  runs?: TextRunSpec[];
  font?: string;
  sizePt?: number;
  color?: string;
  /** Paragraph (box) text width/height; omit for point text. */
  box?: {w: number; h: number};
  rtl?: boolean;
  warp?: {style: string; bend: number; horizontalDistort: boolean};
}

const RTL_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function detectRtl(text: string): boolean {
  return RTL_RE.test(text);
}

/** Arabic–Indic digits ⇄ ASCII digits helpers used by the text panel. */
export function arabicDigits(s: string): string {
  return s.replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

export function latinDigits(s: string): string {
  return s.replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));
}

export const TextStudio = {
  /** Add a text layer. RTL is detected automatically (Arabic shaping upstream). */
  async add(opts: AddTextOptions): Promise<number> {
    const params: Record<string, unknown> = {
      text: opts.text,
      x: opts.x,
      y: opts.y,
      font: opts.font ?? 'Cairo',
      sizePt: opts.sizePt ?? 42,
      color: opts.color ?? '#101014',
      rtl: opts.rtl ?? detectRtl(opts.text),
    };
    if (opts.runs?.length) {
      params.runs = opts.runs; // character styles: font/size/color/tracking per run
    }
    if (opts.box) {
      params.shape = 'paragraph';
      params.box = opts.box; // paragraph text wraps inside the box
    } else {
      params.shape = 'point';
    }
    if (opts.warp) {
      params.warp = opts.warp;
    }
    const reply = await Editor.runCommand('text.add', params);
    return reply.id ?? -1;
  },

  async setText(id: number, text: string) {
    await Editor.runCommand('text.set', {id, text, rtl: detectRtl(text)});
  },

  async setStyle(id: number, style: Partial<TextRunSpec>) {
    await Editor.runCommand('text.style', {id, ...style});
  },

  /** Kerning/tracking/leading of a run (in 1/1000 em, like upstream PSD units). */
  async setMetrics(id: number, run: number, tracking: number, leading?: number) {
    await Editor.runCommand('text.metrics', {id, run, tracking, leading});
  },

  /** Font manager: list installed/bundled fonts with fallback chains. */
  async listFonts(): Promise<Array<{family: string; styles: string[]; variable: boolean}>> {
    const reply = await Editor.runCommand('text.fonts', {});
    return reply.fonts ?? [];
  },

  /** Text transform (rotation/scale of the layer transform matrix). */
  async transform(id: number, matrix: number[]) {
    await Editor.runCommand('text.transform', {id, matrix});
  },

  /** Build a text layer from a local OCR hit (metadata persisted in the layer). */
  async addFromOcr(
    text: string,
    box: {x: number; y: number; w: number; h: number; angle: number},
    confidence: number,
  ): Promise<number> {
    const metadata: OcrMetadata = {
      engine: 'paddleocr-local',
      confidence,
      box,
      language: detectRtl(text) ? (/[a-zA-Z]/.test(text) ? 'mixed' : 'ar') : 'en',
    };
    const reply = await Editor.runCommand('text.add', {
      text,
      x: box.x,
      y: box.y,
      sizePt: Math.max(12, Math.round(box.h * 0.8)),
      metadata,
    });
    return reply.id ?? -1;
  },
};
