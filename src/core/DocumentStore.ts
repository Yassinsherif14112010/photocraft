/**
 * Document store: owns the engine session and the editor state.
 * Every mutation goes to the Rust engine first (`engine.execute`), then the
 * returned layer tree updates the store. Undo/redo replays engine snapshots
 * (`edit.undo` / `edit.redo` are real engine commands, not JS copies).
 */
import {useSyncExternalStore} from 'react';
import {Engine, engineJson} from '../native/PhotoCraftEngine';
import type {DocumentInfo, LayerSummary} from './types';

export interface EditorState {
  sessionId: number | null;
  doc: DocumentInfo | null;
  layers: LayerSummary[];
  activeLayerId: number | null;
  busy: boolean;
  error: string | null;
}

type Listener = () => void;

let state: EditorState = {
  sessionId: null,
  doc: null,
  layers: [],
  activeLayerId: null,
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

function getState() {
  return state;
}

export function useEditor(): EditorState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ---------------------------------------------------------------- session

export async function newDocument(name: string, width: number, height: number, dpi = 72) {
  set({busy: true, error: null});
  try {
    const {sessionId, commands} = await Engine.engineCommands();
    await engineJson(Engine.call(sessionId, 'doc.new', {name, width, height, dpi}));
    const info = await inspect(sessionId);
    set({sessionId, busy: false, ...(info as object)});
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
    set({sessionId, busy: false, ...(info as object)});
  } catch (e: any) {
    set({busy: false, error: String(e?.message ?? e)});
  }
}

export async function closeSession() {
  const {sessionId} = state;
  if (sessionId != null) {
    await Engine.closeSession(sessionId);
  }
  set({sessionId: null, doc: null, layers: [], activeLayerId: null});
}

async function inspect(sessionId: number) {
  const reply = await engineJson<{
    document?: {width: number; height: number; dpi: number; layerCount: number};
    layers?: LayerSummary[];
  }>(Engine.call(sessionId, 'doc.inspect', {}));
  const doc = reply.document ?? {width: 1080, height: 1080, dpi: 72, layerCount: 0};
  const layers = reply.layers ?? [];
  return {doc, layers, activeLayerId: layers[0]?.id ?? null};
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
  setActiveLayer,
  refresh,
  undo,
  redo,
};
