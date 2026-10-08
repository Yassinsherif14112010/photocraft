/**
 * OCR Engine — local PaddleOCR pipeline (DB text detection + CRNN recognition,
 * Arabic + English) running fully on-device via ONNX Runtime (Kotlin:
 * ai/OcrEngine.kt). Produces bounding boxes with confidence scores, detects
 * the language per hit, batches multi-image jobs, and converts every result
 * into real editable text layers (`type.create` + OCR provenance notes that
 * persist with the document and round-trip through PSD annotations).
 * No cloud, no paid API.
 */
import {Ocr} from '../../native/PhotoCraftEngine';
import type {OcrBoxResult} from '../../native/PhotoCraftEngine';
import {Editor} from '../DocumentStore';
import {addFromOcr} from './TextStudio';
import type {OcrMetadata} from '../types';

export interface OcrHit {
  text: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  language: 'ar' | 'en' | 'mixed';
}

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_RE = /[a-zA-Z]/;

/** Script-based language detection on the recognized text. */
export function detectLanguage(text: string): 'ar' | 'en' | 'mixed' {
  const hasAr = ARABIC_RE.test(text);
  const hasLatin = LATIN_RE.test(text);
  if (hasAr && hasLatin) return 'mixed';
  if (hasAr) return 'ar';
  return 'en';
}

export const OcrEngine = {
  async isReady(): Promise<boolean> {
    try {
      return await Ocr.isModelReady();
    } catch {
      return false;
    }
  },

  async modelsDir(): Promise<string> {
    return Ocr.modelsDir();
  },

  /**
   * Detect + recognize all text in a base64 image payload (data URL ok).
   * Hits are language-tagged and sorted top-to-bottom, then left-to-right
   * (right-to-left for Arabic lines — RTL-aware reading order).
   */
  async detectAndRecognize(imageBase64: string): Promise<OcrHit[]> {
    // The native module replies `{boxes: "<json array>"}` (string-encoded).
    const reply = await Ocr.detectAndRecognize(imageBase64);
    const parsed = typeof reply.boxes === 'string' ? JSON.parse(reply.boxes ?? '[]') : ((reply as any).boxes ?? []);
    const boxes: OcrBoxResult['boxes'] = Array.isArray(parsed) ? parsed : [];
    const hits: OcrHit[] = boxes.map(b => ({
      text: b.text,
      confidence: b.confidence,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      angle: b.angle,
      language: detectLanguage(b.text),
    }));
    const rtlFirst = hits.some(h => h.language !== 'en');
    hits.sort((a, b) => {
      if (Math.abs(a.y - b.y) > Math.max(a.h, b.h, 24) * 0.6) {
        return a.y - b.y;
      }
      return rtlFirst ? b.x - a.x : a.x - b.x;
    });
    return hits;
  },

  /**
   * Batch OCR over several images (one native pipeline run each; results kept
   * per image with its index).
   */
  async batch(images: string[]): Promise<Array<{index: number; hits: OcrHit[]}>> {
    const out: Array<{index: number; hits: OcrHit[]}> = [];
    for (let i = 0; i < images.length; i++) {
      out.push({index: i, hits: await OcrEngine.detectAndRecognize(images[i])});
    }
    return out;
  },

  /**
   * Create real text layers from OCR hits (one layer per box, with persisted
   * provenance). Runs as one undoable batch; `minConfidence` filters junk.
   */
  async createTextLayers(hits: OcrHit[], minConfidence = 0.6): Promise<number[]> {
    const ids: number[] = [];
    for (const hit of hits) {
      if (hit.confidence < minConfidence || !hit.text.trim()) {
        continue;
      }
      ids.push(await addFromOcr(hit.text, hit, hit.confidence));
    }
    return ids;
  },

  /** Attach OCR provenance to an existing layer (real note; PSD round-trip). */
  async tagLayer(layerId: number, metadata: OcrMetadata) {
    await Editor.runCommand('notes.add', {
      x: metadata.box.x,
      y: metadata.box.y,
      text: JSON.stringify({ocr: metadata, layer: layerId}),
      author: 'OCR',
    });
  },

  /** Provenance notes currently in the document (`notes.list`). */
  async provenance(): Promise<Array<{text: string; position: [number, number]}>> {
    const reply = await Editor.runCommand('notes.list', {});
    return (reply.notes ?? []).filter((n: any) => n.author === 'OCR');
  },
};
