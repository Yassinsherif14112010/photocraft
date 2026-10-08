/**
 * Text Studio — Text Layers, point & paragraph text, RTL (Arabic + English),
 * character & paragraph styles, font manager, variable-font axis values,
 * kerning/tracking/leading/baseline-shift, warp, transform, presets,
 * templates, text effects and metadata persistence. All shaping/layout runs
 * in the vendored `photocraft-text` crate through the engine's real `type.*`
 * commands (see rust-core/crates/engine/src/type_cmds.rs) — every call below
 * is a registered engine command, so results persist to PSD/PSB and are fully
 * undoable.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Editor} from '../DocumentStore';
import type {CharStyleSpec, OcrMetadata, ParagraphStyleSpec} from '../types';

export interface AddTextOptions {
  text: string;
  x: number;
  y: number;
  /** Per-range character styles (engine `type.edit {runs}`). */
  runs?: Array<CharStyleSpec & {start: number; end: number}>;
  font?: string;
  sizePt?: number;
  color?: string;
  /** Paragraph (box) text width/height; omit for point text. */
  box?: {w: number; h: number};
  rtl?: boolean;
  align?: ParagraphStyleSpec['align'];
  name?: string;
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

// ------------------------------------------------------------------ fonts

export interface FontFace {
  family: string;
  weight: number;
  italic: boolean;
  axes?: Array<{tag: string; min: number; default: number; max: number}>;
}

export interface FontCollection {
  id: string;
  name: string;
  families: string[];
}

const KEY_FONT_FAV = 'pc.text.fontFavorites';
const KEY_FONT_RECENT = 'pc.text.fontRecents';
const KEY_FONT_COLL = 'pc.text.fontCollections';
const KEY_FONT_CATS = 'pc.text.fontCategories';

/** Heuristic family categories (serif/sans/display/mono) used by the font browser. */
function categorize(family: string): string {
  const f = family.toLowerCase();
  if (/(mono|code|consol)/.test(f)) return 'mono';
  if (/(serif|times|georgia|garamond|amiri|naskh|scheherazade)/.test(f) && !/sans/.test(f)) return 'serif';
  if (/(display|headline|poster|lalezar|bungee|bella)/.test(f)) return 'display';
  if (/(arab|cairo|tajawal|amiri|kufi|naskh|noto.*arabic|dubai)/.test(f)) return 'arabic';
  return 'sans';
}

export const TextStudio = {
  /**
   * Add a text layer (engine `type.create`). RTL is detected automatically and
   * the paragraph direction is set explicitly, so Arabic shaping is applied by
   * the engine's shaper.
   */
  async add(opts: AddTextOptions): Promise<number> {
    const rtl = opts.rtl ?? detectRtl(opts.text);
    const params: Record<string, unknown> = {
      text: opts.text,
      x: opts.x,
      y: opts.y,
      font: opts.font ?? 'Cairo',
      size: opts.sizePt ?? 42,
      color: opts.color ?? '#101014',
      name: opts.name,
      language: rtl ? 'ar' : 'en',
    };
    if (opts.align) {
      params.align = opts.align;
    }
    params.direction = rtl ? 'rtl' : 'ltr';
    if (opts.box) {
      params.box = [opts.x, opts.y, opts.box.w, opts.box.h]; // paragraph text
    }
    const reply = await Editor.runCommand('type.create', params);
    const id = reply.layer ?? -1;
    if (opts.runs?.length) {
      // Per-range character styles land through `type.edit {runs}` (one undo step).
      await Editor.runCommand('type.edit', {
        layer: id,
        runs: opts.runs.map(r => ({...r})),
      });
    }
    return id;
  },

  /** Replace the whole text, styles kept (engine `type.edit {text}`). */
  async setText(id: number, text: string) {
    await Editor.runCommand('type.edit', {layer: id, text, direction: detectRtl(text) ? 'rtl' : 'ltr'});
  },

  /** Character style of a range (default: all) — engine `type.setStyle`. */
  async setStyle(id: number, range: {start: number; end: number} | null, style: CharStyleSpec) {
    const params: Record<string, unknown> = {layer: id, ...style};
    if (range) {
      params.range = [range.start, range.end];
    }
    await Editor.runCommand('type.setStyle', params);
  },

  /** Paragraph style — align/indents/leading/direction on the layer. */
  async setParagraphStyle(id: number, style: ParagraphStyleSpec) {
    await Editor.runCommand('type.setStyle', {layer: id, ...style});
  },

  /** Manual kerning after a caret char, or over a range (1/1000 em). */
  async setKerning(id: number, value: number | 'metrics' | 'optical' | 'off', range?: {start: number; end: number}) {
    const params: Record<string, unknown> = {layer: id, kerning: value};
    if (range) {
      params.range = [range.start, range.end];
    }
    await Editor.runCommand('type.setStyle', params);
  },

  /** Kerning of one pair via `type.edit {kernPair}` (Alt+←/→ behaviour). */
  async kernPair(id: number, atCaret: number, by: number) {
    await Editor.runCommand('type.edit', {layer: id, kernPair: {at: atCaret, by}});
  },

  /** Tracking/leading convenience wrapper (1/1000 em / pt). */
  async setMetrics(id: number, tracking: number, leading?: number | 'auto') {
    const style: CharStyleSpec = {tracking};
    if (leading !== undefined) {
      style.leading = leading;
    }
    await TextStudio.setStyle(id, null, style);
  },

  /** Baseline shift in pt. */
  async setBaselineShift(id: number, shift: number) {
    await TextStudio.setStyle(id, null, {baselineShift: shift});
  },

  /** Text transform — engine `type.edit {transform:[a,b,c,d,e,f]}`. */
  async transform(id: number, matrix: number[]) {
    await Editor.runCommand('type.edit', {layer: id, transform: matrix});
  },

  /** Move a text layer (`type.edit {move:[dx,dy]}`). */
  async move(id: number, dx: number, dy: number) {
    await Editor.runCommand('type.edit', {layer: id, move: [dx, dy]});
  },

  /** Point ⇄ paragraph conversion. */
  async convertToParagraph(id: number, box: {w: number; h: number}, x: number, y: number) {
    await Editor.runCommand('type.edit', {layer: id, box: [x, y, box.w, box.h]});
  },

  async convertToPoint(id: number, x: number, y: number) {
    await Editor.runCommand('type.edit', {layer: id, point: [x, y]});
  },

  /** Warp Text (engine `type.warpText`). */
  async warp(id: number, style: string, bend: number, horizontalDistort: boolean) {
    await Editor.runCommand('type.warpText', {layer: id, style, bend, horizontalDistortion: horizontalDistort});
  },

  /** Horizontal/vertical type orientation. */
  async setOrientation(id: number, orientation: 'horizontal' | 'vertical') {
    await Editor.runCommand(
      orientation === 'vertical' ? 'type.orientation.vertical' : 'type.orientation.horizontal',
      {layer: id},
    );
  },

  /** Find & replace across all text layers (`edit.findAndReplaceText`). */
  async findAndReplace(find: string, replace: string) {
    await Editor.runCommand('edit.findAndReplaceText', {find, replace});
  },

  /** Convert a text layer into pixels (`type.rasterize`). */
  async rasterize(id: number) {
    await Editor.runCommand('type.rasterize', {layer: id});
  },

  /** Full style/text readback (text, runs, shape, lines, bounds). */
  async info(id: number) {
    const reply = await Editor.runCommand('type.info', {layer: id});
    return reply;
  },

  // ---------------------------------------------------------- font manager

  /** Real font families + faces from the engine's font book (`type.fonts`). */
  async listFonts(): Promise<FontFace[]> {
    const reply = await Editor.runCommand('type.fonts', {});
    const faces: FontFace[] = (reply.faces ?? []).map((f: any) => ({
      family: f.family,
      weight: f.weight ?? 400,
      italic: f.italic ?? false,
      axes: f.axes ?? undefined,
    }));
    return faces;
  },

  /** Faces of one family with their variable-font axes (`type.fonts {family}`). */
  async familyFaces(family: string): Promise<FontFace[]> {
    const reply = await Editor.runCommand('type.fonts', {family});
    return (reply.faces ?? []).map((f: any) => ({
      family: f.family,
      weight: f.weight ?? 400,
      italic: f.italic ?? false,
      axes: f.axes ?? undefined,
    }));
  },

  /** Search families by substring (client-side over the engine's real list). */
  async searchFonts(query: string): Promise<string[]> {
    const faces = await TextStudio.listFonts();
    const q = query.trim().toLowerCase();
    const families = [...new Set(faces.map(f => f.family))];
    if (!q) {
      return families;
    }
    return families.filter(f => f.toLowerCase().includes(q));
  },

  async fontFavorites(): Promise<string[]> {
    return JSON.parse((await AsyncStorage.getItem(KEY_FONT_FAV)) ?? '[]');
  },

  async recentFonts(): Promise<string[]> {
    return JSON.parse((await AsyncStorage.getItem(KEY_FONT_RECENT)) ?? '[]');
  },

  async pushRecentFont(family: string) {
    const rec = (await TextStudio.recentFonts()).filter(f => f !== family);
    rec.unshift(family);
    await AsyncStorage.setItem(KEY_FONT_RECENT, JSON.stringify(rec.slice(0, 12)));
  },

  async toggleFontFavorite(family: string): Promise<boolean> {
    const favs = new Set(await TextStudio.fontFavorites());
    if (favs.has(family)) {
      favs.delete(family);
    } else {
      favs.add(family);
    }
    await AsyncStorage.setItem(KEY_FONT_FAV, JSON.stringify([...favs]));
    return favs.has(family);
  },

  /** Named font collections (e.g. "Arabic Headlines"). */
  async fontCollections(): Promise<FontCollection[]> {
    return JSON.parse((await AsyncStorage.getItem(KEY_FONT_COLL)) ?? '[]');
  },

  async saveFontCollection(name: string, families: string[]): Promise<FontCollection> {
    const colls = await TextStudio.fontCollections();
    const coll: FontCollection = {id: `coll-${Date.now()}`, name, families};
    const next = [coll, ...colls.filter(c => c.name !== name)].slice(0, 30);
    await AsyncStorage.setItem(KEY_FONT_COLL, JSON.stringify(next));
    return coll;
  },

  async deleteFontCollection(id: string): Promise<void> {
    const colls = await TextStudio.fontCollections();
    await AsyncStorage.setItem(KEY_FONT_COLL, JSON.stringify(colls.filter(c => c.id !== id)));
  },

  /** Category buckets over the engine's families (serif/sans/arabic/mono/display). */
  async fontCategories(): Promise<Record<string, string[]>> {
    const faces = await TextStudio.listFonts();
    const families = [...new Set(faces.map(f => f.family))];
    const saved = JSON.parse((await AsyncStorage.getItem(KEY_FONT_CATS)) ?? '{}') as Record<string, string>;
    const out: Record<string, string[]> = {};
    for (const family of families) {
      const cat = saved[family] ?? categorize(family);
      (out[cat] ??= []).push(family);
    }
    return out;
  },

  // ------------------------------------------------------ styles & presets

  /** Named character styles — real engine style sheets (`type.characterStyle.*`). */
  async characterStyles(): Promise<Array<{name: string}>> {
    const reply = await Editor.runCommand('type.characterStyle', {});
    return reply.styles ?? [];
  },

  async newCharacterStyle(name: string, fromLayer?: number) {
    await Editor.runCommand('type.characterStyle.new', {name, layer: fromLayer});
  },

  async applyCharacterStyle(id: number, name: string) {
    await Editor.runCommand('type.characterStyle.apply', {layer: id, name});
  },

  /** Named paragraph styles (`type.paragraphStyle.*`). */
  async newParagraphStyle(name: string, fromLayer?: number) {
    await Editor.runCommand('type.paragraphStyle.new', {name, layer: fromLayer});
  },

  async applyParagraphStyle(id: number, name: string) {
    await Editor.runCommand('type.paragraphStyle.apply', {layer: id, name});
  },

  /** Text presets — typography starters applied to a fresh or existing layer. */
  async applyPreset(id: number, preset: TextPreset) {
    await Editor.runCommand('type.setStyle', {layer: id, ...preset.char, ...preset.para});
  },
};

export interface TextPreset {
  id: string;
  label: string;
  labelAr: string;
  char: CharStyleSpec;
  para?: ParagraphStyleSpec;
}

/** Built-in typography presets (real style payloads, not decorations). */
export const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'headline-ar',
    label: 'Arabic Headline',
    labelAr: 'عنوان عربي',
    char: {font: 'Cairo', size: 96, weight: 800, tracking: -10, caps: 'normal'},
    para: {align: 'right', direction: 'rtl'},
  },
  {
    id: 'headline-en',
    label: 'Headline',
    labelAr: 'عنوان',
    char: {font: 'Inter', size: 88, weight: 800, tracking: -20, caps: 'all'},
    para: {align: 'left', direction: 'ltr'},
  },
  {
    id: 'body',
    label: 'Body',
    labelAr: 'نص أساسي',
    char: {font: 'Cairo', size: 32, weight: 400, tracking: 0, leading: 'auto'},
    para: {align: 'right', direction: 'rtl', hyphenate: true},
  },
  {
    id: 'caption',
    label: 'Caption',
    labelAr: 'تعليق',
    char: {font: 'Cairo', size: 24, weight: 600, tracking: 40, caps: 'small'},
    para: {align: 'center'},
  },
  {
    id: 'price-tag',
    label: 'Price Tag',
    labelAr: 'بطاقة سعر',
    char: {font: 'Cairo', size: 64, weight: 900, tracking: 0},
    para: {align: 'center'},
  },
];

/** Social-media text presets (real style payloads applied via type.setStyle). */
export const SOCIAL_TEXT_PRESETS: TextPreset[] = [
  {
    id: 'ig-cover',
    label: 'IG Cover Line',
    labelAr: 'غلاف إنستغرام',
    char: {font: 'Cairo', size: 84, weight: 900, tracking: -10},
    para: {align: 'center'},
  },
  {
    id: 'yt-shout',
    label: 'YT Shout',
    labelAr: 'صرخة يوتيوب',
    char: {font: 'Inter', size: 96, weight: 900, tracking: 0, caps: 'all'},
    para: {align: 'center'},
  },
  {
    id: 'story-hook',
    label: 'Story Hook',
    labelAr: 'خطاف الستوري',
    char: {font: 'Cairo', size: 72, weight: 800},
    para: {align: 'center', direction: 'rtl'},
  },
  {
    id: 'tiktok-caption',
    label: 'TikTok Caption',
    labelAr: 'تعليق تيك توك',
    char: {font: 'Cairo', size: 40, weight: 700, leading: 56},
    para: {align: 'center'},
  },
];

/** Arabic typography presets — RTL-native, shaped by the engine. */
export const ARABIC_TEXT_PRESETS: TextPreset[] = [
  {
    id: 'ar-title',
    label: 'عنوان كوفي',
    labelAr: 'عنوان كوفي',
    char: {font: 'Cairo', size: 110, weight: 900, tracking: 0},
    para: {align: 'right', direction: 'rtl'},
  },
  {
    id: 'ar-naskh-body',
    label: 'متن نسخي',
    labelAr: 'متن نسخي',
    char: {font: 'Cairo', size: 34, weight: 400, leading: 'auto'},
    para: {align: 'right', direction: 'rtl', autoLeading: 160},
  },
  {
    id: 'ar-quote',
    label: 'اقتباس',
    labelAr: 'اقتباس',
    char: {font: 'Cairo', size: 56, weight: 600, baselineShift: 0},
    para: {align: 'center', direction: 'rtl'},
  },
  {
    id: 'ar-cta',
    label: 'دعوة لتصرّف',
    labelAr: 'دعوة لتصرّف',
    char: {font: 'Cairo', size: 64, weight: 900, tracking: 20},
    para: {align: 'center', direction: 'rtl'},
  },
];

/** Curated font pairs (headline + body) drawn from the engine's font book. */
export const FONT_PAIRS: Array<{label: string; labelAr: string; headline: string; body: string}> = [
  {label: 'Cairo + Cairo', labelAr: 'القاهرة + القاهرة', headline: 'Cairo', body: 'Cairo'},
  {label: 'Inter + Cairo', labelAr: 'إنتر + القاهرة', headline: 'Inter', body: 'Cairo'},
  {label: 'Inter + Inter', labelAr: 'إنتر + إنتر', headline: 'Inter', body: 'Inter'},
];

/** Text templates — multi-command compositions persisted as steps. */
export interface TextTemplate {
  id: string;
  label: string;
  labelAr: string;
  build: (x: number, y: number) => Array<{command: string; params: object}>;
}

export const TEXT_TEMPLATES: TextTemplate[] = [
  {
    id: 'quote-card',
    label: 'Quote Card',
    labelAr: 'بطاقة اقتباس',
    build: (x, y) => [
      {command: 'type.create', params: {text: '«اقتباس ملهم يغير يومك»', x, y: y + 120, size: 64, font: 'Cairo', direction: 'rtl', align: 'center', color: '#0F172A'}},
      {command: 'type.create', params: {text: '— المؤلف', x, y: y + 260, size: 32, font: 'Cairo', direction: 'rtl', color: '#64748B'}},
    ],
  },
  {
    id: 'sale-badge',
    label: 'Sale Duo',
    labelAr: 'عرض بيع',
    build: (x, y) => [
      {command: 'type.create', params: {text: 'SALE', x, y, size: 120, weight: 900, color: '#DC2626', caps: 'all'}},
      {command: 'type.create', params: {text: '50% OFF', x, y: y + 140, size: 56, color: '#DC2626'}},
    ],
  },
];

/** Build a text layer from a local OCR hit (metadata persisted as a note). */
export async function addFromOcr(
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
  const reply = await Editor.runCommand('type.create', {
    text,
    x: box.x,
    y: box.y + box.h, // baseline anchor at the box bottom
    size: Math.max(12, Math.round(box.h * 0.8)),
    language: metadata.language === 'ar' ? 'ar' : 'en',
    direction: metadata.language === 'en' ? 'ltr' : 'rtl',
    name: text.slice(0, 24),
  });
  const id = reply.layer ?? -1;
  // OCR provenance: a real document note (PSD annotations round-trip, notes.list).
  await Editor.runCommand('notes.add', {
    x: box.x,
    y: box.y,
    text: JSON.stringify({ocr: metadata, layer: id}),
    author: 'OCR',
  });
  return id;
}
