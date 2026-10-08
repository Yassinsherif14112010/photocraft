/**
 * OCR Engine — local PaddleOCR pipeline (detect + recognize, Arabic + English)
 * running fully on-device via ONNX Runtime. Produces bounding boxes with
 * confidence scores, builds real text layers (`CreateTextLayerFromOCR`), and
 * persists OCR metadata with the document. No cloud, no paid API.
 */
import {Ocr, engineJson} from '../../native/PhotoCraftEngine';
import type {OcrBoxResult} from '../../native/PhotoCraftEngine';
import {TextStudio} from './TextStudio';
import type {OcrMetadata} from '../types';

export interface OcrHit {
  text: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

export const OcrEngine = {
  async isReady(): Promise<boolean> {
    try {
      return await Ocr.isModelReady();
    } catch {
      return false;
    }
  },

  /**
   * Detect + recognize all text in a base64 image payload (data URL ok).
   * Returns hits sorted top-to-bottom, left-to-right (RTL-aware ordering).
   */
  async detectAndRecognize(imageBase64: string): Promise<OcrHit[]> {
    const reply = await engineJson<OcrBoxResult>(Ocr.detectAndRecognize(imageBase64));
    const hits = (reply.boxes ?? []).map(b => ({
      text: b.text,
      confidence: b.confidence,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      angle: b.angle,
    }));
    hits.sort((a, b) => (Math.abs(a.y - b.y) > 24 ? a.y - b.y : a.x - b.x));
    return hits;
  },

  /** Create real text layers from OCR hits (one layer per box, with metadata). */
  async createTextLayers(hits: OcrHit[], minConfidence = 0.6): Promise<number[]> {
    const ids: number[] = [];
    for (const hit of hits) {
      if (hit.confidence < minConfidence || !hit.text.trim()) {
        continue;
      }
      ids.push(await TextStudio.addFromOcr(hit.text, hit, hit.confidence));
    }
    return ids;
  },

  /** Attach OCR provenance to an existing layer (persisted in document JSON). */
  async tagLayer(layerId: number, metadata: OcrMetadata) {
    await Editor.runCommand('layer.metadata', {id: layerId, ocr: metadata});
  },
};
