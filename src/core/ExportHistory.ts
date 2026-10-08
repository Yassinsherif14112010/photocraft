/**
 * Export history — persisted in AsyncStorage; every entry points to a real
 * file the engine wrote (path + bytes + format). Rendered in Export Center.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ExportHistoryItem {
  id: string;
  path: string;
  format: string;
  bytes: number;
  at: number;
  docName: string;
  width: number;
  height: number;
}

const KEY = 'pc.export.history';

export const ExportHistory = {
  async list(): Promise<ExportHistoryItem[]> {
    try {
      return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
    } catch {
      return [];
    }
  },

  async add(item: Omit<ExportHistoryItem, 'id'>) {
    const all = await ExportHistory.list();
    const next: ExportHistoryItem[] = [{id: `e${Date.now()}`, ...item}, ...all].slice(0, 40);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
    return next;
  },

  async clear() {
    await AsyncStorage.setItem(KEY, '[]');
  },
};

/** Honest rough estimate for the pre-export size hint (labeled as estimate). */
export function estimateBytes(
  format: string,
  w: number,
  h: number,
  scalePct: number,
  quality: number,
): number {
  const px = (w * scalePct) / 100 * ((h * scalePct) / 100);
  switch (format) {
    case 'png':
      return Math.round(px * 3.6);
    case 'jpg':
      return Math.round((px * (quality / 100) * 0.9) / 1);
    case 'webp':
      return Math.round(px * (quality / 100) * 0.55);
    case 'psd':
      return Math.round(px * 4.2);
    case 'psb':
      return Math.round(px * 4.4);
    default:
      return Math.round(px * 0.8);
  }
}

export function formatBytes(b: number): string {
  if (b > 1024 * 1024) {
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (b > 1024) {
    return `${(b / 1024).toFixed(0)} KB`;
  }
  return `${b} B`;
}
