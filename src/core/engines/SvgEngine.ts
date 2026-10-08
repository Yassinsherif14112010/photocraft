/**
 * SVG Engine — import, export, layer creation, groups, metadata, validation.
 * Uses the vendored `photocraft-vector` crate through the engine: SVG shapes
 * become real vector layers (not rasterized bitmaps), groups map 1:1, and
 * export writes clean SVG from vector layers.
 */
import {Editor} from '../DocumentStore';

export interface SvgImportReport {
  layerId: number;
  warnings: string[];
  shapes: number;
  groups: number;
}

export const SvgEngine = {
  /** Import an SVG file into the document as vector layers. */
  async import(path: string, name?: string): Promise<SvgImportReport> {
    const reply = await Editor.runCommand('svg.import', {path, name: name ?? 'SVG'});
    return {
      layerId: reply.id,
      warnings: reply.warnings ?? [],
      shapes: reply.shapes ?? 0,
      groups: reply.groups ?? 0,
    };
  },

  /** Import raw SVG text (Asset Library ships bundled SVGs this way). */
  async importText(svg: string, name = 'SVG'): Promise<SvgImportReport> {
    const reply = await Editor.runCommand('svg.importText', {svg, name});
    return {
      layerId: reply.id,
      warnings: reply.warnings ?? [],
      shapes: reply.shapes ?? 0,
      groups: reply.groups ?? 0,
    };
  },

  /** Export vector layers (whole doc or a subtree) as SVG text. */
  async export(path?: string): Promise<string> {
    const reply = await Editor.runCommand('svg.export', path ? {path} : {});
    return reply.svg ?? '';
  },

  /** Validate before import: well-formed XML, viewBox present, sane size. */
  async validate(svg: string): Promise<{ok: boolean; reason?: string}> {
    if (!svg.trim().startsWith('<svg') && !svg.includes('<svg')) {
      return {ok: false, reason: 'not an SVG document'};
    }
    if (svg.length > 8 * 1024 * 1024) {
      return {ok: false, reason: 'SVG larger than 8 MB'};
    }
    const reply = await Editor.runCommand('svg.validate', {svg});
    return {ok: reply.ok ?? true, reason: reply.reason};
  },

  /** Embed SVG metadata (title/description) on the layer for round-trips. */
  async setMetadata(layerId: number, title: string, description?: string) {
    await Editor.runCommand('svg.metadata', {id: layerId, title, description});
  },
};
