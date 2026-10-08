/**
 * Shared document-side types (mirrors of the engine's JSON surfaces).
 * The authoritative model lives in the Rust core; these are the typed views
 * the UI renders and edits.
 */

export type BlendMode =
  | 'PassThrough'
  | 'Normal'
  | 'Dissolve'
  | 'Darken'
  | 'Multiply'
  | 'ColorBurn'
  | 'LinearBurn'
  | 'DarkerColor'
  | 'Lighten'
  | 'Screen'
  | 'ColorDodge'
  | 'LinearDodge'
  | 'LighterColor'
  | 'Overlay'
  | 'SoftLight'
  | 'HardLight'
  | 'VividLight'
  | 'LinearLight'
  | 'PinLight'
  | 'HardMix'
  | 'Difference'
  | 'Exclusion'
  | 'Subtract'
  | 'Divide'
  | 'Hue'
  | 'Saturation'
  | 'Color'
  | 'Luminosity';

export type EffectKind =
  | 'DropShadow'
  | 'InnerShadow'
  | 'OuterGlow'
  | 'InnerGlow'
  | 'Stroke'
  | 'ColorOverlay'
  | 'GradientOverlay'
  | 'PatternOverlay'
  | 'Satin'
  | 'BevelAndEmboss';

export interface LayerSummary {
  id: number;
  name: string;
  kind: string; // raster | text | group | shape | smart | …
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  hasMask: boolean;
  children?: LayerSummary[];
}

export interface DocumentInfo {
  width: number;
  height: number;
  dpi: number;
  layerCount: number;
}

export interface TextRunSpec {
  font: string;
  sizePt: number;
  color: string; // #RRGGBB
  bold?: boolean;
  italic?: boolean;
  tracking?: number;
  leading?: number;
  rtl?: boolean;
}

export interface OcrMetadata {
  engine: 'paddleocr-local';
  confidence: number;
  box: {x: number; y: number; w: number; h: number; angle: number};
  language: 'ar' | 'en' | 'mixed';
}

export interface SmartPreset {
  id: string;
  label: string;
  labelAr: string;
  width: number;
  height: number;
  safeAreaPct: number; // percent of the shortest side kept clear at the edges
}

export const SMART_PRESETS: SmartPreset[] = [
  {id: 'ig-post', label: 'Instagram Post', labelAr: 'إنستغرام — منشور', width: 1080, height: 1080, safeAreaPct: 6},
  {id: 'ig-story', label: 'Instagram Story', labelAr: 'إنستغرام — ستوري', width: 1080, height: 1920, safeAreaPct: 12},
  {id: 'fb-post', label: 'Facebook Post', labelAr: 'فيسبوك — منشور', width: 1200, height: 630, safeAreaPct: 6},
  {id: 'tiktok', label: 'TikTok', labelAr: 'تيك توك', width: 1080, height: 1920, safeAreaPct: 14},
  {id: 'yt-thumb', label: 'YouTube Thumbnail', labelAr: 'يوتيوب — صورة مصغرة', width: 1280, height: 720, safeAreaPct: 8},
  {id: 'pin', label: 'Pinterest Pin', labelAr: 'بنترست', width: 1000, height: 1500, safeAreaPct: 8},
];

export const BLEND_MODES: BlendMode[] = [
  'Normal', 'Dissolve', 'Darken', 'Multiply', 'ColorBurn', 'LinearBurn', 'DarkerColor',
  'Lighten', 'Screen', 'ColorDodge', 'LinearDodge', 'LighterColor', 'Overlay',
  'SoftLight', 'HardLight', 'VividLight', 'LinearLight', 'PinLight', 'HardMix',
  'Difference', 'Exclusion', 'Subtract', 'Divide', 'Hue', 'Saturation', 'Color',
  'Luminosity', 'PassThrough',
];

export const EFFECT_KINDS: EffectKind[] = [
  'DropShadow', 'InnerShadow', 'OuterGlow', 'InnerGlow', 'Stroke',
  'ColorOverlay', 'GradientOverlay', 'PatternOverlay', 'Satin', 'BevelAndEmboss',
];
