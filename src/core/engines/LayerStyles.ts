/**
 * Layer Styles — the ten Photoshop-grade effects driven by the engine's real
 * `layer.layerStyle.*` commands (see rust-core/crates/engine/src/layer_style.rs):
 * dropShadow, innerShadow, outerGlow, innerGlow, stroke, colorOverlay,
 * gradientOverlay, patternOverlay (real patterns via `pattern.list`),
 * satin and bevelEmboss — with contours, copy/paste
 * (`copyLayerStyle`/`pasteLayerStyle`), replace/clear, scaling, presets and
 * JSON serialization. Effects live in the engine (`doc::Effects`), round-trip
 * through PSD `lfx2` blocks and are fully undoable.
 */
import {Editor, getState} from '../DocumentStore';
import {Engine, engineJson} from '../../native/PhotoCraftEngine';
import type {EffectKind} from '../types';
import {STYLE_CONTOURS} from '../types';

export interface GradientOverlayParams {
  from?: string; // "#rrggbb"
  to?: string;
  style?: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
  angle?: number;
  scale?: number; // 10..150
  reverse?: boolean;
  opacity?: number; // 0..100
  blend?: string;
}

export interface PatternOverlayParams {
  /** Pattern id or name from `pattern.list` (required for a real overlay). */
  pattern?: string;
  opacity?: number;
  blend?: string;
  scale?: number; // 1..1000
  angle?: number;
  link?: boolean;
  phaseX?: number;
  phaseY?: number;
}

export interface BevelEmbossParams {
  style?: 'inner' | 'outer' | 'emboss' | 'pillow' | 'stroke';
  technique?: 'smooth' | 'chiselHard' | 'chiselSoft';
  depth?: number; // 1..1000
  direction?: 'up' | 'down';
  size?: number;
  soften?: number;
  angle?: number;
  altitude?: number;
  contour?: string; // contour name from STYLE_CONTOURS
  contourRange?: number;
  texture?: string; // pattern id|name
  textureScale?: number;
  textureDepth?: number;
  textureInvert?: boolean;
}

export interface EffectSpec {
  kind: EffectKind;
  enabled?: boolean;
  /** Shared params (shadows/glows/overlays/satin/stroke). */
  color?: string;
  opacity?: number; // 0..100 (engine unit)
  blend?: string;
  angle?: number;
  distance?: number;
  spread?: number;
  size?: number;
  noise?: number;
  contour?: string;
  useGlobalLight?: boolean;
  knocksOut?: boolean;
  /** stroke */
  position?: 'outside' | 'inside' | 'center';
  /** outerGlow/innerGlow */
  technique?: 'softer' | 'precise';
  range?: number;
  source?: 'edge' | 'center';
  choke?: number;
  /** gradientOverlay */
  gradient?: GradientOverlayParams;
  /** patternOverlay */
  pattern?: PatternOverlayParams;
  /** bevelEmboss */
  bevel?: BevelEmbossParams;
}

/** Per-kind param remap: the UI spec → the engine's flat command params. */
function effectParams(e: EffectSpec): Record<string, unknown> {
  switch (e.kind) {
    case 'gradientOverlay':
      return {...(e.gradient ?? {})};
    case 'patternOverlay':
      return {...(e.pattern ?? {})};
    case 'bevelEmboss':
      return {...(e.bevel ?? {})};
    default: {
      const {kind: _k, enabled: _e, gradient: _g, pattern: _p, bevel: _b, ...rest} = e;
      return rest;
    }
  }
}

export interface StylePreset {
  name: string;
  effects: EffectSpec[];
}

/** Reusable style presets (Brand Kit shares these). */
export const STYLE_PRESETS: StylePreset[] = [
  {
    name: 'Neon Glow',
    effects: [
      {kind: 'outerGlow', color: '#22D3EE', size: 24, opacity: 90, technique: 'softer'},
      {kind: 'dropShadow', color: '#0EA5E9', distance: 0, size: 32, opacity: 80},
    ],
  },
  {
    name: 'Cinematic Shadow',
    effects: [
      {kind: 'dropShadow', color: '#000000', angle: 120, distance: 18, spread: 4, size: 30, opacity: 55},
    ],
  },
  {
    name: 'Sticker Cut',
    effects: [
      {kind: 'stroke', color: '#FFFFFF', size: 12, position: 'outside'},
      {kind: 'dropShadow', color: '#000000', distance: 6, size: 12, opacity: 40},
    ],
  },
  {
    name: 'Emboss Plate',
    effects: [
      {kind: 'bevelEmboss', bevel: {depth: 300, size: 8, angle: 135, technique: 'chiselHard', style: 'inner'}},
      {kind: 'satin', color: '#1E293B', size: 9, opacity: 35},
    ],
  },
  {
    name: 'Sunset Gradient',
    effects: [
      {
        kind: 'gradientOverlay',
        gradient: {from: '#F97316', to: '#DB2777', angle: 90, style: 'linear'},
        opacity: 85,
      },
    ],
  },
];

export const LayerStyles = {
  /** Apply (replace) the full effect stack — engine `layer.layerStyle.replace`. */
  async apply(layerId: number, effects: EffectSpec[]) {
    const payload = effects
      .filter(e => e.enabled !== false)
      .map(e => ({kind: e.kind, params: effectParams(e)}));
    await Editor.runCommand('layer.layerStyle.replace', {layer: layerId, effects: payload});
  },

  /**
   * Add or edit one effect (engine `layer.layerStyle.<kind>` with `add`).
   * Editing an existing effect of the same kind updates it in place.
   */
  async set(layerId: number, effect: EffectSpec) {
    const params = {layer: layerId, add: true, ...effectParams(effect)};
    await Editor.runCommand(`layer.layerStyle.${effect.kind}`, params);
  },

  /** Convenience alias used by the editor panel: upsert then enable. */
  async upsert(layerId: number, effect: EffectSpec) {
    await LayerStyles.set(layerId, effect);
  },

  /** Remove one effect by kind — rebuild the stack without it (one step). */
  async removeKind(layerId: number, kind: EffectKind) {
    const current = await LayerStyles.copy(layerId);
    const kept = current.filter(e => e.kind !== kind);
    await LayerStyles.apply(layerId, kept);
  },

  /** Toggle the whole layer style on/off (`layer.setProps`? no — hide/show all). */
  async setEnabled(layerId: number, enabled: boolean) {
    await Editor.runCommand(enabled ? 'layer.layerStyle.showAllEffects' : 'layer.layerStyle.hideAllEffects', {layer: layerId});
  },

  /** Clear every effect (`layer.layerStyle.clear`). */
  async clear(layerId: number) {
    await Editor.runCommand('layer.layerStyle.clear', {layer: layerId});
  },

  /** Scale all distances/sizes (`layer.layerStyle.scaleEffects`). */
  async scale(layerId: number, percent: number) {
    await Editor.runCommand('layer.layerStyle.scaleEffects', {layer: layerId, scale: percent});
  },

  /** Photoshop Layer Style copy/paste — real clipboard inside the engine. */
  async copy(layerId: number) {
    await Editor.runCommand('layer.layerStyle.copyLayerStyle', {layer: layerId});
    return LayerStyles.read(layerId);
  },

  async paste(layerId: number) {
    await Editor.runCommand('layer.layerStyle.pasteLayerStyle', {layer: layerId});
    return LayerStyles.read(layerId);
  },

  /** Read the current stack back (doc.inspect → layer effects summary). */
  async read(layerId: number) {
    const {sessionId} = getState();
    if (sessionId == null) {
      return [];
    }
    const doc = await engineJson<{layers?: Array<{id: number; effects?: {items?: Array<Record<string, unknown>>}}>}>(
      Engine.call(sessionId, 'doc.inspect', {}),
    );
    const find = (layers: Array<{id: number; effects?: {items?: Array<Record<string, unknown>>}}>): Array<Record<string, unknown>> => {
      for (const l of layers) {
        if (l.id === layerId) {
          return l.effects?.items ?? [];
        }
        const found = find((l as any).children ?? []);
        if (found.length) {
          return found;
        }
      }
      return [];
    };
    return find(doc.layers ?? []) as Array<{kind: EffectKind; [k: string]: unknown}>;
  },

  /** Real pattern library for patternOverlay (`pattern.list`). */
  async listPatterns(): Promise<Array<{id: string; name: string}>> {
    const reply = await Editor.runCommand('pattern.list', {});
    return reply.patterns ?? [];
  },

  /** Define a document pattern from a PNG/JPEG file (`edit.definePattern`). */
  async definePatternFromImage(path: string, name: string) {
    const reply = await Editor.runCommand('edit.definePattern', {path, name});
    return reply.pattern ?? reply;
  },

  /** Validate a spec before sending it to the engine (honest client checks). */
  validate(effect: EffectSpec): string | null {
    if (!(EFFECT_KIND_SET as readonly string[]).includes(effect.kind)) {
      return `unknown effect kind "${effect.kind}"`;
    }
    if (effect.opacity !== undefined && (effect.opacity < 0 || effect.opacity > 100)) {
      return 'opacity must be 0..100';
    }
    if (effect.contour && !CONTOUR_SET.includes(effect.contour)) {
      return `unknown contour "${effect.contour}"`;
    }
    if (effect.kind === 'patternOverlay' && !effect.pattern?.pattern) {
      return 'patternOverlay needs a pattern (see LayerStyles.listPatterns)';
    }
    if (effect.kind === 'gradientOverlay' && effect.gradient?.scale !== undefined) {
      const s = effect.gradient.scale;
      if (s < 10 || s > 150) {
        return 'gradient scale must be 10..150';
      }
    }
    return null;
  },

  /** Serialize a stack to JSON (used by Brand Kit reusable styles). */
  serialize(effects: EffectSpec[]): string {
    return JSON.stringify(effects);
  },

  deserialize(json: string): EffectSpec[] {
    const parsed = JSON.parse(json) as EffectSpec[];
    for (const e of parsed) {
      const err = LayerStyles.validate(e);
      if (err) {
        throw new Error(`invalid style payload: ${err}`);
      }
    }
    return parsed;
  },
};

const EFFECT_KIND_SET: readonly string[] = [
  'dropShadow', 'innerShadow', 'outerGlow', 'innerGlow', 'stroke',
  'colorOverlay', 'gradientOverlay', 'patternOverlay', 'satin', 'bevelEmboss',
];

const CONTOUR_SET: readonly string[] = STYLE_CONTOURS;
