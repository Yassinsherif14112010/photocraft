/**
 * Projects store — real project management on top of the engine's own
 * save/load. Everything here is backed by files the engine wrote
 * (`doc.save` .pcraft/PSD) plus a AsyncStorage index:
 *   - recent projects with last-opened timestamps
 *   - auto-save tracking (the current session's autosave file)
 *   - named version history (real document snapshots via doc.save)
 *   - duplicate project (saveACopy under a new name)
 *   - tags + search over the project index
 * No cloud, no fake entries — a project row exists only after the engine
 * actually wrote its file.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Engine} from '../native/PhotoCraftEngine';

export interface ProjectMeta {
  id: string;
  name: string;
  /** Engine-written project file (.pcraft). */
  path: string;
  width: number;
  height: number;
  lastOpened: number;
  tags: string[];
}

export interface VersionMeta {
  id: string;
  label: string;
  path: string;
  at: number;
}

const KEY_PROJECTS = 'pc.projects.index';
const KEY_VERSIONS = 'pc.projects.versions';
const KEY_AUTOSAVE = 'pc.projects.autosave';

export const FILES_DIR = '/data/data/com.photocraft.mobile/files';
export const AUTOSAVE_PATH = `${FILES_DIR}/autosave/current.pcraft`;

async function readIndex(): Promise<ProjectMeta[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY_PROJECTS)) ?? '[]');
  } catch {
    return [];
  }
}

async function writeIndex(list: ProjectMeta[]) {
  await AsyncStorage.setItem(KEY_PROJECTS, JSON.stringify(list.slice(0, 60)));
}

export const ProjectsStore = {
  async list(): Promise<ProjectMeta[]> {
    const list = await readIndex();
    return list.sort((a, b) => b.lastOpened - a.lastOpened);
  },

  /** Upsert a project row after the engine saved its file. */
  async upsert(meta: {name: string; path: string; width: number; height: number}) {
    if (!meta.path) {
      return;
    }
    const list = await readIndex();
    const existing = list.find(p => p.path === meta.path);
    const row: ProjectMeta = {
      id: existing?.id ?? `p${Date.now()}`,
      name: meta.name || existing?.name || 'Untitled',
      path: meta.path,
      width: meta.width,
      height: meta.height,
      lastOpened: Date.now(),
      tags: existing?.tags ?? [],
    };
    const next = [row, ...list.filter(p => p.path !== meta.path)];
    await writeIndex(next);
    await AsyncStorage.setItem(KEY_AUTOSAVE, JSON.stringify(row));
    return row;
  },

  async touch(path: string) {
    const list = await readIndex();
    const row = list.find(p => p.path === path);
    if (row) {
      row.lastOpened = Date.now();
      await writeIndex(list);
    }
  },

  async remove(path: string) {
    const list = await readIndex();
    await writeIndex(list.filter(p => p.path !== path));
  },

  async setTags(path: string, tags: string[]) {
    const list = await readIndex();
    const row = list.find(p => p.path === path);
    if (row) {
      row.tags = tags.map(t => t.trim()).filter(Boolean).slice(0, 12);
      await writeIndex(list);
    }
  },

  async search(query: string): Promise<ProjectMeta[]> {
    const q = query.trim().toLowerCase();
    const list = await ProjectsStore.list();
    if (!q) {
      return list;
    }
    return list.filter(
      p => p.name.toLowerCase().includes(q) || p.tags.some(t => t.toLowerCase().includes(q)),
    );
  },

  /** The most recent autosave row (for Home "Continue editing"). */
  async continueCandidate(): Promise<ProjectMeta | null> {
    try {
      const row = JSON.parse((await AsyncStorage.getItem(KEY_AUTOSAVE)) ?? 'null') as ProjectMeta | null;
      return row ?? (await ProjectsStore.list())[0] ?? null;
    } catch {
      return null;
    }
  },

  // ------------------------------------------------------------- versions

  async versions(): Promise<VersionMeta[]> {
    try {
      return JSON.parse((await AsyncStorage.getItem(KEY_VERSIONS)) ?? '[]');
    } catch {
      return [];
    }
  },

  /** Write a real snapshot of the open document and register it. */
  async saveVersion(sessionId: number, label: string): Promise<VersionMeta> {
    const path = `${FILES_DIR}/versions/v-${Date.now()}.pcraft`;
    const reply = await Engine.saveDocument(sessionId, path, 'pcraft', 100);
    if ((reply as {error?: string}).error) {
      throw new Error((reply as {error?: string}).error);
    }
    const meta: VersionMeta = {id: `v${Date.now()}`, label, path, at: Date.now()};
    const all = await ProjectsStore.versions();
    await AsyncStorage.setItem(KEY_VERSIONS, JSON.stringify([meta, ...all].slice(0, 40)));
    return meta;
  },

  // ------------------------------------------------------------ duplicates

  /** Save a copy of the open document under a new name (real file). */
  async duplicateAs(sessionId: number, name: string): Promise<string> {
    const safe = name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Copy';
    const path = `${FILES_DIR}/projects/${safe}-${Date.now()}.pcraft`;
    const reply = await Engine.saveDocument(sessionId, path, 'pcraft', 100);
    if ((reply as {error?: string}).error) {
      throw new Error((reply as {error?: string}).error);
    }
    return path;
  },

  async registerOpened(meta: {name: string; path: string; width: number; height: number}) {
    return ProjectsStore.upsert(meta);
  },
};
