/**
 * Brand Kit — brand colors, fonts, logos, templates, reusable styles and
 * presets. Persisted locally (AsyncStorage JSON) and import/exportable as a
 * `.pcbrand` JSON file through the native file IO (real app-storage read/
 * write). Applied into documents through real engine commands so every usage
 * is a genuine layer/style that survives PSD round-trips.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Editor} from '../DocumentStore';
import {LayerStyles} from './LayerStyles';
import {FileIO} from '../../native/PhotoCraftEngine';
import type {EffectSpec} from './LayerStyles';

const KEY = 'pc.brandkit.v1';
const KIT_DIR = '/data/data/com.photocraft.mobile/files/brandkit';

export interface BrandKit {
  name: string;
  colors: string[];
  fonts: string[];
  logos: string[]; // file paths (PNG/SVG) in app storage
  templates: BrandTemplate[];
  styles: ReusableStyle[];
}

export interface BrandTemplate {
  id: string;
  name: string;
  nameAr: string;
  width: number;
  height: number;
  /** Engine commands that rebuild the template in a fresh document. */
  steps: Array<{command: string; params: object}>;
}

export interface ReusableStyle {
  name: string;
  effects: EffectSpec[];
}

const DEFAULT_KIT: BrandKit = {
  name: 'My Brand',
  colors: ['#0F172A', '#2563EB', '#22D3EE', '#F59E0B', '#EF4444', '#F8FAFC'],
  fonts: ['Cairo', 'Tajawal', 'Inter'],
  logos: [],
  templates: [
    {
      id: 'post-square',
      name: 'Square Post',
      nameAr: 'منشور مربع',
      width: 1080,
      height: 1080,
      steps: [
        {command: 'edit.fill', params: {contents: 'color', color: '#0F172A'}},
        {command: 'type.create', params: {text: 'عنوان العرض', x: 80, y: 260, size: 88, font: 'Cairo', direction: 'rtl', align: 'right', color: '#F8FAFC'}},
      ],
    },
    {
      id: 'story-vertical',
      name: 'Vertical Story',
      nameAr: 'ستوري عمودي',
      width: 1080,
      height: 1920,
      steps: [
        {command: 'edit.fill', params: {contents: 'color', color: '#2563EB'}},
        {command: 'type.create', params: {text: 'NEW COLLECTION', x: 80, y: 420, size: 96, color: '#F8FAFC'}},
      ],
    },
  ],
  styles: [],
};

export const BrandKitStore = {
  async load(): Promise<BrandKit> {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      return {...DEFAULT_KIT};
    }
    return {...DEFAULT_KIT, ...(JSON.parse(raw) as BrandKit)};
  },

  async save(kit: BrandKit): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify(kit));
  },

  /** Reset to the shipped defaults. */
  async reset(): Promise<BrandKit> {
    await AsyncStorage.setItem(KEY, JSON.stringify(DEFAULT_KIT));
    return {...DEFAULT_KIT};
  },

  /** Apply a brand template into a NEW document (real engine steps). */
  async applyTemplate(kit: BrandKit, template: BrandTemplate): Promise<void> {
    await Editor.newDocument(template.name, template.width, template.height);
    for (const step of template.steps) {
      await Editor.runCommand(step.command, step.params);
    }
  },

  /** Paint a shape/layer with a brand color (real fill op, not a filter). */
  async applyBrandColor(layerId: number, color: string): Promise<void> {
    await Editor.runCommand('layer.select', {id: layerId});
    await Editor.runCommand('edit.fill', {contents: 'color', color, preserveTransparency: false});
  },

  /** Set the text color of a text layer from the brand palette. */
  async applyBrandColorToText(layerId: number, color: string): Promise<void> {
    await Editor.runCommand('type.setStyle', {layer: layerId, color});
  },

  /** Apply a saved reusable style stack. */
  async applyStyle(layerId: number, style: ReusableStyle): Promise<void> {
    await LayerStyles.apply(layerId, style.effects);
  },

  /** Save the current layer's effects as a reusable brand style. */
  async captureStyle(layerId: number, name: string): Promise<ReusableStyle> {
    const items = await LayerStyles.read(layerId);
    const effects = items.map(it => ({kind: it.kind, ...(it as object)} as EffectSpec));
    const style: ReusableStyle = {name, effects};
    const kit = await BrandKitStore.load();
    kit.styles = [style, ...kit.styles.filter(s => s.name !== name)].slice(0, 40);
    await BrandKitStore.save(kit);
    return style;
  },

  // -------------------------------------------------------- import/export

  /** Export the kit as a `.pcbrand` JSON file in app storage. */
  async exportKit(kit: BrandKit): Promise<string> {
    const safe = kit.name.replace(/[^\w\u0600-\u06FF-]+/g, '_') || 'brand';
    const path = `${KIT_DIR}/${safe}-${Date.now()}.pcbrand`;
    if (!FileIO) {
      throw new Error('native file IO missing — rebuild the app');
    }
    await FileIO.writeTextFile(path, JSON.stringify({kind: 'pcbrand', version: 1, kit}, null, 2));
    return path;
  },

  /** Import a kit from a `.pcbrand` file and make it current. */
  async importKit(path: string): Promise<BrandKit> {
    if (!FileIO) {
      throw new Error('native file IO missing — rebuild the app');
    }
    const text = await FileIO.readTextFile(path);
    const parsed = JSON.parse(text) as {kind?: string; version?: number; kit?: BrandKit};
    const kit = parsed.kit ?? (parsed as unknown as BrandKit);
    if (!kit || !Array.isArray(kit.colors)) {
      throw new Error('not a PhotoCraft brand kit file');
    }
    const merged = {...DEFAULT_KIT, ...kit};
    await BrandKitStore.save(merged);
    return merged;
  },

  /** Register a picked logo (copied into app storage by the caller). */
  async addLogo(path: string): Promise<BrandKit> {
    const kit = await BrandKitStore.load();
    if (!kit.logos.includes(path)) {
      kit.logos = [path, ...kit.logos].slice(0, 12);
      await BrandKitStore.save(kit);
    }
    return kit;
  },

  // ------------------------------------------------------ colors & fonts

  async addColor(color: string): Promise<BrandKit> {
    const kit = await BrandKitStore.load();
    if (/^#[0-9a-fA-F]{6}$/.test(color) && !kit.colors.includes(color.toUpperCase())) {
      kit.colors = [color.toUpperCase(), ...kit.colors].slice(0, 24);
      await BrandKitStore.save(kit);
    }
    return kit;
  },

  async removeColor(color: string): Promise<BrandKit> {
    const kit = await BrandKitStore.load();
    kit.colors = kit.colors.filter(c => c !== color);
    await BrandKitStore.save(kit);
    return kit;
  },

  async addFont(family: string): Promise<BrandKit> {
    const kit = await BrandKitStore.load();
    if (family.trim() && !kit.fonts.includes(family.trim())) {
      kit.fonts = [family.trim(), ...kit.fonts].slice(0, 16);
      await BrandKitStore.save(kit);
    }
    return kit;
  },

  async removeFont(family: string): Promise<BrandKit> {
    const kit = await BrandKitStore.load();
    kit.fonts = kit.fonts.filter(f => f !== family);
    await BrandKitStore.save(kit);
    return kit;
  },

  /** Place a brand logo into the document as a real layer. */
  async placeLogo(kit: BrandKit, index: number, centerX: number, centerY: number, size = 240): Promise<number> {
    const path = kit.logos[index];
    if (!path) {
      throw new Error('no logo at that index');
    }
    const reply = await Editor.runCommand('file.placeEmbedded', {path, fit: false, center: [centerX, centerY]});
    return reply.layer as number;
  },
};
