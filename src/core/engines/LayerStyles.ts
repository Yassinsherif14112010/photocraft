/**
 * Layer Styles — the ten Photoshop-grade effects (Drop Shadow, Inner Shadow,
 * Outer Glow, Inner Glow, Stroke, Color Overlay, Gradient Overlay, Pattern
 * Overlay, Satin, Bevel & Emboss) with serialization, persistence and
 * undo/redo. The effects live in the engine (`doc::Effects`) and round-trip
 * through PSD `lfx2` blocks — mobile edits save into real PSDs.
 */
import {Editor} from '../DocumentStore';
import type {EffectKind} from '../types';

export interface EffectSpec {
  kind: EffectKind;
  enabled: boolean;
  color?: string;
  opacity?: number; // 0..1
  angleDeg?: number;
  distance?: number;
  spread?: number;
  size?: number;
  noise?: number;
  /** Stroke */
  position?: 'outside' | 'inside' | 'center';
  /** Gradient overlay */
  gradient?: {stops: Array<{pos: number; color: string}>; angleDeg: number; style: string};
  /** Pattern overlay */
  pattern?: {name: string; id: string; scale: number; link: boolean};
  /** Bevel & emboss */
  depth?: number;
  technique?: 'smooth' | 'chiselHard' | 'chiselSoft';
  style?: 'outerBevel' | 'innerBevel' | 'emboss' | 'pillowEmboss' | 'strokeEmboss';
}

export interface StylePreset {
  name: string;
  effects: EffectSpec[];
}

/** Reusable style presets (Brand Kit shares these via `styles.clone`). */
export const STYLE_PRESETS: StylePreset[] = [
  {
    name: 'Neon Glow',
    effects: [
      {kind: 'OuterGlow', enabled: true, color: '#22D3EE', size: 24, opacity: 0.9},
      {kind: 'DropShadow', enabled: true, color: '#0EA5E9', distance: 0, size: 32, opacity: 0.8},
    ],
  },
  {
    name: 'Cinematic Shadow',
    effects: [
      {kind: 'DropShadow', enabled: true, color: '#000000', angleDeg: 120, distance: 18, spread: 4, size: 30, opacity: 0.55},
    ],
  },
  {
    name: 'Sticker Cut',
    effects: [
      {kind: 'Stroke', enabled: true, color: '#FFFFFF', size: 12, position: 'outside'},
      {kind: 'DropShadow', enabled: true, color: '#000000', distance: 6, size: 12, opacity: 0.4},
    ],
  },
  {
    name: 'Emboss Plate',
    effects: [
      {kind: 'BevelAndEmboss', enabled: true, depth: 300, size: 8, angleDeg: 135, technique: 'chiselHard'},
      {kind: 'Satin', enabled: true, color: '#1E293B', size: 9, opacity: 0.35},
    ],
  },
  {
    name: 'Sunset Gradient',
    effects: [
      {
        kind: 'GradientOverlay',
        enabled: true,
        gradient: {
          stops: [
            {pos: 0, color: '#F97316'},
            {pos: 1, color: '#DB2777'},
          ],
          angleDeg: 90,
          style: 'linear',
        },
        opacity: 0.85,
      },
    ],
  },
];

export const LayerStyles = {
  /** Apply (replace) the full effect stack of a layer. */
  async apply(layerId: number, effects: EffectSpec[]) {
    await Editor.runCommand('effects.set', {id: layerId, effects});
  },

  /** Toggle one effect on/off without dropping it. */
  async toggle(layerId: number, index: number, enabled: boolean) {
    await Editor.runCommand('effects.toggle', {id: layerId, index, enabled});
  },

  async remove(layerId: number, index: number) {
    await Editor.runCommand('effects.remove', {id: layerId, index});
  },

  /** Copy the whole style like Photoshop's Layer Style copy/paste. */
  async copy(layerId: number) {
    const reply = await Editor.runCommand('effects.copy', {id: layerId});
    return reply.effects as EffectSpec[];
  },

  async paste(layerId: number, effects: EffectSpec[]) {
    await LayerStyles.apply(layerId, effects);
  },

  /** Serialize a stack to JSON (used by Brand Kit reusable styles). */
  serialize(effects: EffectSpec[]): string {
    return JSON.stringify(effects);
  },

  deserialize(json: string): EffectSpec[] {
    return JSON.parse(json) as EffectSpec[];
  },
};
