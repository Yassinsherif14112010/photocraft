/**
 * Shared document-side types (mirrors of the engine's JSON surfaces).
 * The authoritative model lives in the Rust core; these are the typed views
 * the UI renders and edits. Field names match `photocraft-engine::inspect`.
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
  | 'dropShadow'
  | 'innerShadow'
  | 'outerGlow'
  | 'innerGlow'
  | 'stroke'
  | 'colorOverlay'
  | 'gradientOverlay'
  | 'patternOverlay'
  | 'satin'
  | 'bevelEmboss';

/** The engine's blend labels ("Color Burn"…) ↔ the union ids ("ColorBurn"). */
export const BLEND_MODES: BlendMode[] = [
  'Normal', 'Dissolve', 'Darken', 'Multiply', 'ColorBurn', 'LinearBurn', 'DarkerColor',
  'Lighten', 'Screen', 'ColorDodge', 'LinearDodge', 'LighterColor', 'Overlay',
  'SoftLight', 'HardLight', 'VividLight', 'LinearLight', 'PinLight', 'HardMix',
  'Difference', 'Exclusion', 'Subtract', 'Divide', 'Hue', 'Saturation', 'Color',
  'Luminosity', 'PassThrough',
];

/** Engine label → union id ("Linear Dodge (Add)" → "LinearDodge"). */
export function blendFromLabel(label: string): BlendMode {
  if (label.startsWith('Linear Dodge')) {
    return 'LinearDodge';
  }
  const id = label.replace(/[\s()]/g, '');
  return (BLEND_MODES as string[]).includes(id) ? (id as BlendMode) : 'Normal';
}

export const EFFECT_KINDS: EffectKind[] = [
  'dropShadow', 'innerShadow', 'outerGlow', 'innerGlow', 'stroke',
  'colorOverlay', 'gradientOverlay', 'patternOverlay', 'satin', 'bevelEmboss',
];

/** Layer contour names accepted by the engine's style commands. */
export const STYLE_CONTOURS = [
  'Linear', 'Cone', 'Cone (Inverted)', 'Domed', 'Domed (Inverted)',
  'Diagonal (Descending)', 'Gaussian', 'Half Round', 'Rounded Steps', 'Sawtooth 1',
] as const;

export interface Rect4 {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayerSummary {
  id: number;
  name: string;
  kind: string; // raster | text | group | shape | smart | adjustment | …
  visible: boolean;
  opacity: number; // 0..1
  fill: number; // 0..1
  blend: BlendMode; // parsed from the engine label
  blendLabel: string; // as reported by the engine
  clipped: boolean;
  hasMask: boolean;
  /** Content bounds [x, y, w, h] in canvas pixels (null for empty layers). */
  bounds: Rect4 | null;
  children?: LayerSummary[];
}

export interface DocumentInfo {
  width: number;
  height: number;
  dpi: number;
  layerCount: number;
}

/** Character style payload — the engine's CHAR_PARAMS surface. */
export interface CharStyleSpec {
  font?: string;
  fontStyle?: string;
  weight?: number; // 100..900
  italic?: boolean;
  size?: number; // pt
  color?: string;
  tracking?: number; // 1/1000 em
  leading?: number | 'auto';
  baselineShift?: number; // pt
  horizontalScale?: number; // %
  verticalScale?: number; // %
  underline?: boolean;
  strikethrough?: boolean;
  fauxBold?: boolean;
  fauxItalic?: boolean;
  kerning?: number | 'metrics' | 'optical' | 'off';
  caps?: 'normal' | 'small' | 'all';
  ligatures?: boolean;
  discretionaryLigatures?: boolean;
  features?: Record<string, number>;
  /** Variable-font axis values, e.g. {"wght": 650}. */
  variations?: Record<string, number>;
  language?: string;
}

/** Paragraph style payload — the engine's paragraph keys. */
export interface ParagraphStyleSpec {
  align?: 'left' | 'center' | 'right' | 'justify' | 'justifyCenter' | 'justifyRight' | 'justifyAll';
  firstLineIndent?: number;
  startIndent?: number;
  endIndent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  autoLeading?: number; // %
  direction?: 'auto' | 'ltr' | 'rtl';
  hyphenate?: boolean;
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
  {id: 'li-post', label: 'LinkedIn Post', labelAr: 'لينكدإن — منشور', width: 1200, height: 1200, safeAreaPct: 8},
];
