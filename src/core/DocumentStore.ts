/**
 * Document store: owns the engine session and the editor state.
 * Every mutation goes to the Rust engine first (`engine.execute`), then the
 * returned layer tree updates the store. Undo/redo replays engine snapshots
 * (`edit.undo` / `edit.redo` are real engine commands, not JS copies).
 */
import {useSyncExternalStore} from 'react';
import {Engine, engineJson} from '../native/PhotoCraftEngine';
import {blendFromLabel} from './types';
import type {DocumentInfo, LayerSummary, Rect4} from './types';

export interface EditorState {
  sessionId: number | null;
  doc: DocumentInfo | null;
  layers: LayerSummary[];
  activeLayerId: number | null;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  error: string | null;
}

type Listener = () => void;

let state: EditorState = {
  sessionId: null,
  doc: null,
  layers: [],
  activeLayerId: null,
  canUndo: false,
  canRedo: false,
  busy: false,
  error: null,
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
  const reply = await engineJson<RawLayer & {activeLayer: number | null; canUndo?: boolean; canRedo?: boolean}>(
    Engine.call(sessionId, 'doc.inspect', {}),
  );
  // The automation reply is the document object itself (inspect::document):
  // width/height/resolution at the top level plus the display-order layer tree.
  const doc: DocumentInfo = {
    width: reply.width,
    height: reply.height,
    dpi: reply.resolution,
    layerCount: reply.layers?.length ?? 0,
  };
  const layers = (reply.layers ?? []).map(convertLayer);
  return {doc, layers, activeLayerId: reply.activeLayer ?? layers[0]?.id ?? null, canUndo: reply.canUndo ?? false, canRedo: reply.canRedo ?? false};
}

// ---------------------------------------------------------------- session

export async function newDocument(name: string, width: number, height: number, dpi = 72) {
  set({busy: true, error: null});
  try {
    const {sessionId} = await Engine.engineCommands();
    // `doc.new` runs the engine's `file.new` (`resolution` is the DPI field).
    await engineJson(Engine.call(sessionId, 'doc.new', {name, width, height, resolution: dpi, background: 'white'}));
    const info = await inspect(sessionId);
    set({sessionId, busy: false, error: null, ...(info as object)});
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
    set({sessionId, busy: false, error: null, ...(info as object)});
  } catch (e: any) {
    set({busy: false, error: String(e?.message ?? e)});
  }
}

export async function closeSession() {
  const {sessionId} = state;
  if (sessionId != null) {
    await Engine.closeSession(sessionId);
  }
  set({sessionId: null, doc: null, layers: [], activeLayerId: null, canUndo: false, canRedo: false});
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

/** Run an engine command; refreshes the layer tree and marks canvas dirty. */
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
};
