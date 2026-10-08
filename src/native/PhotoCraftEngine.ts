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
}

export interface OcrEngineNative {
  isModelReady(): Promise<boolean>;
  modelsDir(): Promise<string>;
  detectAndRecognize(image: string): Promise<{boxes: string}>;
}

export interface BackgroundRemovalNative {
  isModelReady(): Promise<boolean>;
  modelsDir(): Promise<string>;
  removeBackgroundQuick(image: string): Promise<CutoutResult>;
  removeBackgroundHQ(image: string): Promise<CutoutResult>;
}

const {PhotoCraftEngine, OcrEngine, BackgroundRemoval} = NativeModules as {
  PhotoCraftEngine: PhotoCraftEngineNative;
  OcrEngine: OcrEngineNative;
  BackgroundRemoval: BackgroundRemovalNative;
};

if (!PhotoCraftEngine) {
  throw new Error(
    'PhotoCraftEngine native module missing — rebuild the app with scripts/build-android.sh',
  );
}

export const Engine = PhotoCraftEngine;
export const Ocr = OcrEngine;
export const BgRemoval = BackgroundRemoval;

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
