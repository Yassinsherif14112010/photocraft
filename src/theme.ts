/**
 * Theme — professional dark & light studio palettes with live switching.
 * Both palettes are tuned for long editing sessions: near-neutral surfaces,
 * one restrained accent, semantic status colors. `system` follows the OS.
 * Choice persists in AsyncStorage and re-renders through useSyncExternalStore.
 */
import {Appearance} from 'react-native';
import {useSyncExternalStore} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Palette {
  mode: 'dark' | 'light';
  /** App background (deepest level). */
  bg: string;
  /** Cards / panels. */
  surface: string;
  /** Raised controls (buttons, inputs). */
  surface2: string;
  /** Hover/press raise. */
  surface3: string;
  border: string;
  borderStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  accent2: string;
  onAccent: string;
  danger: string;
  dangerSoft: string;
  warn: string;
  success: string;
  successSoft: string;
  /** Canvas checkerboard base (transparency indicator). */
  checker: string;
  checkerAlt: string;
  /** Overlay scrim behind sheets. */
  scrim: string;
  radius: number;
  radiusSm: number;
  spacing: number;
  fontAr: string;
  fontEn: string;
}

export const darkPalette: Palette = {
  mode: 'dark',
  bg: '#0E0E12',
  surface: '#17171E',
  surface2: '#20202A',
  surface3: '#2A2A36',
  border: '#2C2C38',
  borderStrong: '#3A3A48',
  text: '#F4F4F6',
  textDim: '#9A9AA8',
  textFaint: '#6B6B7A',
  accent: '#3B82F6',
  accentSoft: 'rgba(59,130,246,0.16)',
  accent2: '#22D3EE',
  onAccent: '#FFFFFF',
  danger: '#EF4444',
  dangerSoft: 'rgba(239,68,68,0.14)',
  warn: '#F59E0B',
  success: '#10B981',
  successSoft: 'rgba(16,185,129,0.14)',
  checker: '#1B1B23',
  checkerAlt: '#24242E',
  scrim: 'rgba(0,0,0,0.55)',
  radius: 14,
  radiusSm: 10,
  spacing: 8,
  fontAr: 'Cairo',
  fontEn: 'Inter',
};

export const lightPalette: Palette = {
  mode: 'light',
  bg: '#F2F3F7',
  surface: '#FFFFFF',
  surface2: '#EEF0F5',
  surface3: '#E3E6EE',
  border: '#DFE2EA',
  borderStrong: '#C9CEDA',
  text: '#17181D',
  textDim: '#5D616E',
  textFaint: '#9096A3',
  accent: '#2563EB',
  accentSoft: 'rgba(37,99,235,0.12)',
  accent2: '#0891B2',
  onAccent: '#FFFFFF',
  danger: '#DC2626',
  dangerSoft: 'rgba(220,38,38,0.10)',
  warn: '#D97706',
  success: '#059669',
  successSoft: 'rgba(5,150,105,0.10)',
  checker: '#E9EBF1',
  checkerAlt: '#F7F8FB',
  scrim: 'rgba(15,18,26,0.45)',
  radius: 14,
  radiusSm: 10,
  spacing: 8,
  fontAr: 'Cairo',
  fontEn: 'Inter',
};

export type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeState {
  mode: ThemeMode;
  palette: Palette;
}

function resolve(mode: ThemeMode): Palette {
  if (mode !== 'system') {
    return mode === 'dark' ? darkPalette : lightPalette;
  }
  return Appearance.getColorScheme() === 'light' ? lightPalette : darkPalette;
}

let state: ThemeState = {mode: 'dark', palette: darkPalette};
const listeners = new Set<() => void>();

function setModeInternal(mode: ThemeMode) {
  state = {mode, palette: resolve(mode)};
  listeners.forEach(l => l());
}

// Follow the OS while in `system` mode.
Appearance.addChangeListener(() => {
  if (state.mode === 'system') {
    setModeInternal('system');
  }
});

const KEY_MODE = 'pc.theme.mode';

/** Restore the persisted choice (call once from App). */
export async function initTheme() {
  try {
    const saved = await AsyncStorage.getItem(KEY_MODE);
    setModeInternal(saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'dark');
  } catch {
    setModeInternal('dark');
  }
}

export const ThemeStore = {
  get(): ThemeState {
    return state;
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setMode(mode: ThemeMode) {
    setModeInternal(mode);
    AsyncStorage.setItem(KEY_MODE, mode).catch(() => {});
  },
};

export function useTheme(): Palette {
  return useSyncExternalStore(ThemeStore.subscribe, () => ThemeStore.get().palette);
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const mode = useSyncExternalStore(ThemeStore.subscribe, () => ThemeStore.get().mode);
  return [mode, ThemeStore.setMode];
}

/** Legacy static export (boot screens before initTheme resolves). */
export const theme = darkPalette;
