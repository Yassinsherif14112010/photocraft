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
import {Engine, FileIO} from '../native/PhotoCraftEngine';
import {projectsDir, versionsDir} from './paths';

export interface ProjectMeta {
  id: string;
  name: string;
  /** Engine-written project file (.pcraft). */
  path: string;
  width: number;
  height: number;
  lastOpened: number;
  tags: string[];
  /** Engine-rendered PNG thumbnail written next to the project file. */
  thumbPath?: string;
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

/** Thumbnail path for a project file (engine-rendered PNG beside it). */
export function thumbPathFor(projectPath: string): string {
  return `${projectPath}.thumb.png`;
}

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
  async upsert(meta: {name: string; path: string; width: number; height: number; thumbPath?: string}) {
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
      thumbPath: meta.thumbPath ?? existing?.thumbPath,
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

  /** Delete a project for real: index row + project file + thumbnail file. */
  async deleteProject(path: string): Promise<boolean> {
    await ProjectsStore.remove(path);
    const keep = (await ProjectsStore.continueCandidateRaw())?.path !== path;
    if (!keep) {
      await AsyncStorage.removeItem(KEY_AUTOSAVE);
    }
    let ok = true;
    try {
      await FileIO?.deleteFile(path);
      await FileIO?.deleteFile(thumbPathFor(path));
    } catch {
      ok = false;
    }
    return ok;
  },

  async continueCandidateRaw(): Promise<ProjectMeta | null> {
    try {
      return JSON.parse((await AsyncStorage.getItem(KEY_AUTOSAVE)) ?? 'null') as ProjectMeta | null;
    } catch {
      return null;
    }
  },

  /** Rename a project: real file move + index + thumbnail move. */
  async rename(path: string, newName: string): Promise<string | null> {
    const list = await readIndex();
    const row = list.find(p => p.path === path);
    if (!row) {
      return null;
    }
    const safe = newName.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Untitled';
    const dir = path.substring(0, path.lastIndexOf('/'));
    const ext = path.endsWith('.pcraft') ? '.pcraft' : path.substring(path.lastIndexOf('.'));
    const to = `${dir}/${safe}-${Date.now()}${ext}`;
    // The record is only updated after the filesystem move really succeeded —
    // a failed move must leave the original project intact and indexed.
    const moved = await FileIO?.moveFile(path, to);
    if (!moved) {
      throw new Error(`rename failed: could not move ${path} → ${to}`);
    }
    const oldThumb = row.thumbPath ?? thumbPathFor(path);
    const newThumb = thumbPathFor(to);
    try {
      await FileIO?.moveFile(oldThumb, newThumb);
    } catch {
      // thumbnail is optional — regenerate on next save
    }
    row.name = safe;
    row.path = to;
    row.thumbPath = newThumb;
    await writeIndex(list.map(p => (p.path === path ? row : p)));
    const cur = await ProjectsStore.continueCandidateRaw();
    if (cur?.path === path) {
      await AsyncStorage.setItem(KEY_AUTOSAVE, JSON.stringify(row));
    }
    return to;
  },

  /** Duplicate a project: real file copy + fresh index row. */
  async duplicate(path: string): Promise<ProjectMeta | null> {
    const list = await readIndex();
    const row = list.find(p => p.path === path);
    if (!row) {
      return null;
    }
    const dir = path.substring(0, path.lastIndexOf('/'));
    const ext = path.endsWith('.pcraft') ? '.pcraft' : path.substring(path.lastIndexOf('.'));
    const to = `${dir}/${row.name} copy-${Date.now()}${ext}`;
    await FileIO?.copyFile(path, to);
    const copy: ProjectMeta = {
      ...row,
      id: `p${Date.now()}`,
      name: `${row.name} copy`,
      path: to,
      lastOpened: Date.now(),
    };
    try {
      await FileIO?.copyFile(row.thumbPath ?? thumbPathFor(path), thumbPathFor(to));
      copy.thumbPath = thumbPathFor(to);
    } catch {
      // thumbnail optional
    }
    await writeIndex([copy, ...list]);
    return copy;
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
    const path = `${versionsDir()}/v-${Date.now()}.pcraft`;
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
    const path = `${projectsDir()}/${safe}-${Date.now()}.pcraft`;
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
