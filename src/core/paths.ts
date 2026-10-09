/**
 * Runtime-resolved app-storage paths. The compile-time constant is only the
 * fallback: on device the real canonical filesDir comes from the native side,
 * so nothing depends on a hardcoded package id (debug `.debug` suffixes,
 * fork builds, work profiles all keep working).
 * `initPaths()` runs once at boot; the sync helpers then use the cached dir.
 */
import {FileIO} from '../native/PhotoCraftEngine';

export const FILES_DIR_FALLBACK = '/data/data/com.photocraft.mobile/files';

let filesDir: string | null = null;

/** Resolve the real filesDir once (call at boot, before screens render). */
export async function initPaths(): Promise<void> {
  try {
    const d = await FileIO?.filesDir();
    if (d) {
      filesDir = d;
      return;
    }
  } catch {
    // native surface unavailable — keep the fallback
  }
  filesDir = FILES_DIR_FALLBACK;
}

/** The resolved dir (or the fallback before boot completes). */
export function appFilesDir(): string {
  return filesDir ?? FILES_DIR_FALLBACK;
}

export const tmpDir = () => `${appFilesDir()}/tmp`;
export const inboxImagePath = () => `${appFilesDir()}/inbox/last.png`;
export const brandKitDir = () => `${appFilesDir()}/brandkit`;
export const exportsDir = () => `${appFilesDir()}/exports`;
export const projectsDir = () => `${appFilesDir()}/projects`;
export const versionsDir = () => `${appFilesDir()}/versions`;
export const autosavePath = () => `${appFilesDir()}/autosave/current.pcraft`;
