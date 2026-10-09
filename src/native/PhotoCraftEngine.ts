/**
 * Typed bridge to the native modules (Kotlin ⇄ JNI ⇄ Rust engine).
 *
 * The engine session is the PhotoCraft automation surface: every method below is
 * the real engine — `doc.new`, `doc.open`, `doc.save`, `doc.inspect`, `doc.render`,
 * `engine.execute {command, params}` — backed by the upstream command registry
 * (layers, groups, masks, blend modes, layer styles, text, SVG, PSD/PSB, export).
 */
import {NativeModules} from 'react-native';

export interface EngineReply {
  result?: string;
  error?: string;
}

export interface OcrBoxResult {
  boxes: Array<{
    text: string;
    confidence: number;
    x: number;
    y: number;
    w: number;
    h: number;
    angle: number;
  }>;
}

export interface CutoutResult {
  rgba: string; // base64 RGBA8
  width: number;
  height: number;
  /** Set when the native side wrote the cutout PNG to disk (file.placeEmbedded input). */
  savedAs?: string;
}

export interface PhotoCraftEngineNative {
  version(): Promise<string>;
  engineCommands(): Promise<{sessionId: number; commands: string}>;
  closeSession(sessionId: number): Promise<boolean>;
  call(sessionId: number, method: string, params: object): Promise<EngineReply>;
  execute(sessionId: number, command: string, params: object): Promise<EngineReply>;
  openDocument(sessionId: number, path: string): Promise<EngineReply>;
  saveDocument(
    sessionId: number,
    path: string,
    format: string,
    quality: number,
  ): Promise<EngineReply>;
  renderThumbnail(sessionId: number, maxSide: number): Promise<string>;
  /** Read a file from app storage as base64 (inbox images for OCR / BG removal). */
  readFileBase64(path: string): Promise<string>;
}

export interface OcrEngineNative {
  isModelReady(): Promise<boolean>;
  modelsDir(): Promise<string>;
  detectAndRecognize(image: string): Promise<{boxes: string}>;
}

export interface BackgroundRemovalNative {
  isModelReady(): Promise<boolean>;
  modelsDir(): Promise<string>;
  /** AI matting. `optionsJson`: {mode:'quick'|'hq', threshold, edgeSmooth, feather, shiftEdge, saveAs?}. */
  removeBackground(image: string, optionsJson: string): Promise<EngineReply>;
  /** Grayscale matte preview PNG (data URL) without touching the document. */
  mattePreview(image: string, optionsJson: string): Promise<EngineReply>;
}

export interface PhotoCraftAssetsNative {
  /** Read a bundled asset file (android assets/asset-library/…). */
  readAsset(path: string): Promise<string>;
}

export interface FileTextNative {
  /** Write UTF-8 text to app storage (brand-kit import/export, JSON payloads). */
  writeTextFile(path: string, contents: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  /** Copy a content:// URI (document picker) into app storage; returns the path. */
  copyUriToCache(uri: string, name: string): Promise<string>;
  /** Write binary data (base64) — engine-rendered project thumbnails. */
  writeBase64File(path: string, base64: string): Promise<boolean>;
  /** Delete a file inside app storage. */
  deleteFile(path: string): Promise<boolean>;
  /** Rename/move a file within app storage. */
  moveFile(from: string, to: string): Promise<boolean>;
  /** Copy a file within app storage; returns the new path. */
  copyFile(from: string, to: string): Promise<string>;
  /** The real application filesDir (single source of truth for paths). */
  filesDir(): Promise<string>;
}

export interface DocumentPickerNative {
  /** Open the system SAF picker. Resolves a content:// Uri, or null on cancel. */
  pickDocument(mimeTypes: string[]): Promise<string | null>;
}

const {PhotoCraftEngine, OcrEngine, BackgroundRemoval, PhotoCraftAssets, FileText, DocumentPicker} = NativeModules as {
  PhotoCraftEngine: PhotoCraftEngineNative;
  OcrEngine: OcrEngineNative;
  BackgroundRemoval: BackgroundRemovalNative;
  PhotoCraftAssets?: PhotoCraftAssetsNative;
  FileText?: FileTextNative;
  DocumentPicker?: DocumentPickerNative;
};

if (!PhotoCraftEngine) {
  throw new Error(
    'PhotoCraftEngine native module missing — rebuild the app with scripts/build-android.sh',
  );
}

export const Engine = PhotoCraftEngine;
export const Ocr = OcrEngine;
export const BgRemoval = BackgroundRemoval;
export const Assets = PhotoCraftAssets;
export const FileIO = FileText;
export const Picker = DocumentPicker;

/** Parse an engine reply into a JSON object or throw. */
export async function engineJson<T>(
  call: Promise<EngineReply>,
): Promise<T> {
  const reply = await call;
  if (reply.error) {
    throw new Error(reply.error);
  }
  return JSON.parse(reply.result ?? '{}') as T;
}
