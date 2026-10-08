/**
 * History manager — thin UI coordinator around the engine's real undo stack.
 * The document history itself lives in the Rust engine (same as desktop);
 * this only tracks labels for the history list and coalesces slider-driven
 * edits so a drag produces ONE undo step, like Photoshop.
 */
import {undo, redo} from './DocumentStore';

export interface HistoryEntry {
  label: string;
  at: number;
}

let stack: HistoryEntry[] = [];
let coalesceKey: string | null = null;

export const History = {
  /** Record a step label (called after a successful engine command). */
  push(label: string, coalesce?: string) {
    if (coalesce && coalesce === coalesceKey && stack.length > 0) {
      stack[stack.length - 1] = {label, at: Date.now()};
      return;
    }
    coalesceKey = coalesce ?? null;
    stack.push({label, at: Date.now()});
    if (stack.length > 200) {
      stack.shift();
    }
  },

  beginCoalesce(key: string) {
    coalesceKey = key;
  },

  endCoalesce() {
    coalesceKey = null;
  },

  entries: (): HistoryEntry[] => [...stack].reverse(),

  clear() {
    stack = [];
    coalesceKey = null;
  },

  async undo(): Promise<void> {
    await undo();
    stack.pop();
  },

  async redo(): Promise<void> {
    await redo();
  },
};
