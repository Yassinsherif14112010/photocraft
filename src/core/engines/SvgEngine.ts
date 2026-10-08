/**
 * SVG Engine — import, export, validation, metadata and capability detection.
 * Backed by the engine's real `svg.*` commands (rust-core/crates/engine/src/
 * svg_cmds.rs): SVG subset → real shape layers (paths, rects, circles,
 * ellipses, lines, polygons, groups, transforms, paints, arcs), groups mapped
 * 1:1 onto layer groups, clean path-data export from vector layers. Anything
 * the subset does not support is reported as a warning — never dropped
 * silently and never rasterized into a fake bitmap.
 */
import {Editor} from '../DocumentStore';

export interface SvgImportReport {
  layerId: number;
  warnings: string[];
  shapes: number;
  groups: number;
  maxDepth: number;
  textElements: number;
  unsupportedElements: number;
  viewBox: [number, number, number, number] | null;
}

export interface SvgInfo {
  ok: boolean;
  reason?: string;
  shapes?: number;
  groups?: number;
  maxDepth?: number;
  textElements?: number;
  images?: number;
  unsupportedElements?: number;
  title?: string;
  description?: string;
  viewBox?: [number, number, number, number] | null;
  warnings?: string[];
  /** Capabilities the importer supports. */
  supported?: string[];
  /** Constructs present in the file but not converted. */
  unsupported?: string[];
}

export const SvgEngine = {
  /** Import an SVG file into the document as real vector layers. */
  async import(path: string, name?: string): Promise<SvgImportReport> {
    const reply = await Editor.runCommand('svg.import', {path, name: name ?? 'SVG'});
    return {
      layerId: reply.layer,
      warnings: reply.warnings ?? [],
      shapes: reply.shapes ?? 0,
      groups: reply.groups ?? 0,
      maxDepth: reply.maxDepth ?? 0,
      textElements: reply.textElements ?? 0,
      unsupportedElements: reply.unsupportedElements ?? 0,
      viewBox: reply.viewBox ?? null,
    };
  },

  /** Import raw SVG text (Asset Library ships bundled SVGs this way). */
  async importText(svg: string, name = 'SVG'): Promise<SvgImportReport> {
    const reply = await Editor.runCommand('svg.importText', {svg, name});
    return {
      layerId: reply.layer,
      warnings: reply.warnings ?? [],
      shapes: reply.shapes ?? 0,
      groups: reply.groups ?? 0,
      maxDepth: reply.maxDepth ?? 0,
      textElements: reply.textElements ?? 0,
      unsupportedElements: reply.unsupportedElements ?? 0,
      viewBox: reply.viewBox ?? null,
    };
  },

  /** Export the document's vector content as SVG text (optionally to a file). */
  async export(path?: string): Promise<string> {
    const reply = await Editor.runCommand('svg.export', path ? {path} : {});
    return reply.svg ?? '';
  },

  /** Validate before import: XML well-formedness and subset support. */
  async validate(svg: string): Promise<{ok: boolean; reason?: string; shapes?: number}> {
    if (!svg.includes('<svg')) {
      return {ok: false, reason: 'not an SVG document'};
    }
    if (svg.length > 32 * 1024 * 1024) {
      return {ok: false, reason: 'SVG larger than 32 MB'};
    }
    const reply = await Editor.runCommand('svg.validate', {svg});
    return {ok: reply.ok ?? false, reason: reply.reason, shapes: reply.shapes};
  },

  /** Layer enumeration metadata + capability detection (engine `svg.info`). */
  async info(svg: string): Promise<SvgInfo> {
    const reply = await Editor.runCommand('svg.info', {svg});
    return reply as SvgInfo;
  },
};
