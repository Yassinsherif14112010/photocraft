/**
 * Document store: owns the engine session and the editor state.
 * Every mutation goes to the Rust engine first (`engine.execute`), then the
 * returned layer tree updates the store. Undo/redo replays engine snapshots
 * (`edit.undo` / `edit.redo` are real engine commands, not JS copies).
 */
import {useSyncExternalStore} from 'react';
import {Engine, engineJson, FileIO} from '../native/PhotoCraftEngine';
import {blendFromLabel} from './types';
import type {DocumentInfo, LayerSummary, Rect4} from './types';
import {ProjectsStore, thumbPathFor} from './ProjectsStore';
import {projectsDir} from './paths';

export interface EditorState {
  sessionId: number | null;
  doc: DocumentInfo | null;
  /** Document/project display name (top bar). */
  docName: string;
  /** Where this project autosaves (real engine-written file). */
  projectPath: string | null;
  layers: LayerSummary[];
  activeLayerId: number | null;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  error: string | null;
  /** Bumped after every mutating command — the canvas re-renders on change. */
  canvasVersion: number;
  /** Set when a background autosave just completed (UI can badge it). */
  lastAutosaveAt: number | null;
  /** Layer locks mirror (engine applies locks; inspect doesn't echo them). */
  locks: Record<number, boolean>;
}

type Listener = () => void;

let state: EditorState = {
  sessionId: null,
  doc: null,
  docName: 'Untitled',
  projectPath: null,
  layers: [],
  activeLayerId: null,
  canUndo: false,
  canRedo: false,
  busy: false,
  error: null,
  canvasVersion: 0,
  lastAutosaveAt: null,
  locks: {},
};

const listeners = new Set<Listener>();

function set(patch: Partial<EditorState>) {
  state = {...state, ...patch};
  listeners.forEach(l => l());
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useEditor(): EditorState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Current state for non-hook modules (engines) — read-only accessor. */
export function getState(): EditorState {
  return state;
}

// ---------------------------------------------------------------- inspection

interface RawLayer {
  id: number;
  name: string;
  kind: string;
  visible: boolean;
  opacity: number;
  fill?: number;
  blend?: string;
  clipped?: boolean;
  hasMask?: boolean;
  bounds?: [number, number, number, number] | null;
  children?: RawLayer[];
}

function convertLayer(raw: RawLayer): LayerSummary {
  const bounds: Rect4 | null = raw.bounds ? {x: raw.bounds[0], y: raw.bounds[1], w: raw.bounds[2], h: raw.bounds[3]} : null;
  const blendLabel = raw.blend ?? 'Normal';
  return {
    id: raw.id,
    name: raw.name,
    kind: raw.kind,
    visible: raw.visible,
    opacity: raw.opacity,
    fill: raw.fill ?? 1,
    blend: blendFromLabel(blendLabel),
    blendLabel,
    clipped: raw.clipped ?? false,
    hasMask: raw.hasMask ?? false,
    bounds,
    children: raw.children?.map(convertLayer),
  };
}

async function inspect(sessionId: number) {
  const reply = await engineJson<
    RawLayer & {
      activeLayer: number | null;
      canUndo?: boolean;
      canRedo?: boolean;
      name?: string;
      width?: number;
      height?: number;
      resolution?: number;
      layers?: RawLayer[];
    }
  >(Engine.call(sessionId, 'doc.inspect', {}));
  // The automation reply is the document object itself (inspect::document):
  // width/height/resolution at the top level plus the display-order layer tree.
  const doc: DocumentInfo = {
    width: reply.width ?? 1080,
    height: reply.height ?? 1080,
    dpi: reply.resolution ?? 72,
    layerCount: reply.layers?.length ?? 0,
  };
  const layers = (reply.layers ?? []).map(convertLayer);
  return {doc, layers, activeLayerId: reply.activeLayer ?? layers[0]?.id ?? null, canUndo: reply.canUndo ?? false, canRedo: reply.canRedo ?? false, docName: reply.name ?? state.docName};
}

// ---------------------------------------------------------------- session

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Untitled';
}

export async function newDocument(name: string, width: number, height: number, dpi = 72) {
  set({busy: true, error: null});
  try {
    const {sessionId} = await Engine.engineCommands();
    // `doc.new` runs the engine's `file.new` (`resolution` is the DPI field).
    await engineJson(Engine.call(sessionId, 'doc.new', {name, width, height, resolution: dpi, background: 'white'}));
    const info = await inspect(sessionId);
    const projectPath = `${projectsDir()}/${safeName(name)}-${Date.now()}.pcraft`;
    set({sessionId, busy: false, error: null, projectPath, canvasVersion: 0, ...(info as object)});
  } catch (e: any) {
    set({busy: false, error: String(e?.message ?? e)});
  }
}

export async function openDocument(path: string) {
  set({busy: true, error: null});
  try {
    const {sessionId} = await Engine.engineCommands();
    await engineJson(Engine.openDocument(sessionId, path));
    const info = await inspect(sessionId);
    set({sessionId, busy: false, error: null, projectPath: path, canvasVersion: 0, ...(info as object)});
    await ProjectsStore.touch(path);
  } catch (e: any) {
    set({busy: false, error: String(e?.message ?? e)});
  }
}

export async function closeSession() {
  const {sessionId} = state;
  if (sessionId != null) {
    await Engine.closeSession(sessionId);
  }
  set({sessionId: null, doc: null, docName: 'Untitled', projectPath: null, layers: [], activeLayerId: null, canUndo: false, canRedo: false});
}

export async function refresh() {
  const {sessionId} = state;
  if (sessionId == null) {
    return;
  }
  const info = await inspect(sessionId);
  set(info as object);
}

// ------------------------------------------------------------- mutations

// Debounced auto-save: 1.4s after the last mutating command the document is
// written to its real project file and the Projects index is updated.
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    autoSaveNow().catch(() => {});
  }, 1400);
}

/**
 * Render the real composite via the engine and write it beside the project
 * file — Home shows this PNG as the project thumbnail. Failures are silent:
 * a missing thumbnail falls back to the placeholder glyph.
 */
async function captureThumbnail(sessionId: number, projectPath: string): Promise<string | undefined> {
  try {
    const dataUrl = await Engine.renderThumbnail(sessionId, 360);
    const b64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
    if (!b64) {
      return undefined;
    }
    const tp = thumbPathFor(projectPath);
    await FileIO?.writeBase64File(tp, b64);
    return tp;
  } catch {
    return undefined;
  }
}

async function autoSaveNow() {
  const {sessionId, projectPath, docName, doc} = state;
  if (sessionId == null || !projectPath || !doc) {
    return;
  }
  const reply = await Engine.saveDocument(sessionId, projectPath, 'pcraft', 100);
  if (!(reply as {error?: string}).error) {
    const thumbPath = await captureThumbnail(sessionId, projectPath);
    await ProjectsStore.upsert({name: docName, path: projectPath, width: doc.width, height: doc.height, thumbPath});
    set({lastAutosaveAt: Date.now()});
  }
}

/** Run an engine command; refreshes the layer tree, bumps canvas + autosaves. */
export async function runCommand(command: string, params: object = {}) {
  const {sessionId} = state;
  if (sessionId == null) {
    throw new Error('no document open');
  }
  set({busy: true});
  try {
    const reply = await Engine.execute(sessionId, command, params);
    if (reply.error) {
      throw new Error(reply.error);
    }
    const info = await inspect(sessionId);
    set(info as object);
    set({canvasVersion: state.canvasVersion + 1});
    scheduleAutosave();
    return JSON.parse(reply.result ?? '{}');
  } finally {
    set({busy: false});
  }
}

/** Run several engine commands as one `batch` step (all-or-nothing). */
export async function runBatch(steps: Array<{command: string; params?: object}>) {
  const {sessionId} = state;
  if (sessionId == null) {
    throw new Error('no document open');
  }
  set({busy: true});
  try {
    const parsed = await engineJson<{results?: Array<{result?: string; error?: string}>}>(
      Engine.call(sessionId, 'batch', {
        steps: steps.map(st => ({method: 'engine.execute', params: {command: st.command, params: st.params ?? {}}})),
      }),
    );
    const failed = parsed.results?.find(r => r.error);
    if (failed) {
      throw new Error(failed.error);
    }
    const info = await inspect(sessionId);
    set(info as object);
    set({canvasVersion: state.canvasVersion + 1});
    scheduleAutosave();
    return parsed;
  } finally {
    set({busy: false});
  }
}

export async function setActiveLayer(id: number) {
  const {sessionId} = state;
  set({activeLayerId: id});
  if (sessionId != null) {
    await Engine.execute(sessionId, 'layer.select', {id});
  }
}

// ------------------------------------------------------------ undo / redo

export async function undo() {
  await runCommand('edit.undo', {});
}

export async function redo() {
  await runCommand('edit.redo', {});
}

/** Rename the document (top bar + projects index). */
export async function renameDocument(name: string) {
  set({docName: name});
  const {sessionId, projectPath, doc} = state;
  if (sessionId != null && projectPath && doc) {
    await ProjectsStore.upsert({name, path: projectPath, width: doc.width, height: doc.height});
  }
}

/** Explicit save (top bar): writes the project file immediately. */
export async function saveNow(): Promise<void> {
  const {sessionId, projectPath, docName, doc} = state;
  if (sessionId == null || !projectPath || !doc) {
    throw new Error('no document open');
  }
  const reply = await Engine.saveDocument(sessionId, projectPath, 'pcraft', 100);
  if ((reply as {error?: string}).error) {
    throw new Error((reply as {error?: string}).error);
  }
  const thumbPath = await captureThumbnail(sessionId, projectPath);
  await ProjectsStore.upsert({name: docName, path: projectPath, width: doc.width, height: doc.height, thumbPath});
  set({lastAutosaveAt: Date.now()});
}

/** Canvas tap → real engine hit-test (topmost layer with pixels there). */
export async function pickLayerAt(x: number, y: number): Promise<number | null> {
  const {sessionId} = state;
  if (sessionId == null) {
    return null;
  }
  const reply = await engineJson<{layer: number | null}>(
    Engine.execute(sessionId, 'layer.pickAt', {x: Math.round(x), y: Math.round(y), select: false}),
  );
  return reply.layer ?? null;
}

/** Lock/unlock a layer (real engine locks block transforms + pixels). */
export async function setLayerLock(id: number, locked: boolean) {
  await runCommand('layer.setProps', {layer: id, locked});
  set({locks: {...state.locks, [id]: locked}});
}

export const Editor = {
  newDocument,
  openDocument,
  closeSession,
  runCommand,
  runBatch,
  setActiveLayer,
  refresh,
  undo,
  redo,
  saveNow,
  renameDocument,
  pickLayerAt,
  setLayerLock,
};
