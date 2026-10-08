/**
 * Brand Kit — brand colors, fonts, logos, templates and reusable styles.
 * Persisted locally (AsyncStorage JSON); applied into documents through the
 * engine so every usage is a real layer/style, kept inside PSD exports.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Editor} from '../DocumentStore';
import {LayerStyles} from './LayerStyles';
import type {EffectSpec} from './LayerStyles';

const KEY = 'pc.brandkit.v1';

export interface BrandKit {
  name: string;
  colors: string[];
  fonts: string[];
  logos: string[]; // file paths (PNG/SVG)
  templates: BrandTemplate[];
  styles: ReusableStyle[];
}

export interface BrandTemplate {
  id: string;
  name: string;
  nameAr: string;
  width: number;
  height: number;
  /** Engine commands to rebuild the template in a fresh document. */
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
        {command: 'background.fill', params: {color: '#0F172A'}},
        {command: 'text.add', params: {text: 'عنوان العرض', x: 80, y: 160, sizePt: 88, font: 'Cairo'}},
      ],
    },
    {
      id: 'story-vertical',
      name: 'Vertical Story',
      nameAr: 'ستوري عمودي',
      width: 1080,
      height: 1920,
      steps: [
        {command: 'background.fill', params: {color: '#2563EB'}},
        {command: 'text.add', params: {text: 'NEW COLLECTION', x: 80, y: 320, sizePt: 96}},
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

  /** Apply a brand template into a NEW document (real engine steps). */
  async applyTemplate(kit: BrandKit, template: BrandTemplate): Promise<void> {
    await Editor.newDocument(template.name, template.width, template.height);
    for (const step of template.steps) {
      await Editor.runCommand(step.command, step.params);
    }
  },

  /** Paint a shape/layer with a brand color (real fill op, not a filter). */
  async applyBrandColor(layerId: number, color: string): Promise<void> {
    await Editor.runCommand('layer.fill', {id: layerId, color});
  },

  /** Apply a saved reusable style stack. */
  async applyStyle(layerId: number, style: ReusableStyle): Promise<void> {
    await LayerStyles.apply(layerId, style.effects);
  },

  /** Save the current layer's effects as a reusable brand style. */
  async captureStyle(layerId: number, name: string): Promise<ReusableStyle> {
    const effects = await LayerStyles.copy(layerId);
    const style: ReusableStyle = {name, effects};
    const kit = await BrandKitStore.load();
    kit.styles = [style, ...kit.styles.filter(s => s.name !== name)].slice(0, 40);
    await BrandKitStore.save(kit);
    return style;
  },
};
