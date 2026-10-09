/**
 * Staging — the share-intent receiver (MainActivity) stages files dropped on
 * Photo Craft into files/inbox/. This module hands those bytes to the AI
 * pipelines as real base64 payloads (read through the native module, which
 * enforces app-storage-only paths).
 */
import {Engine} from '../native/PhotoCraftEngine';
import {inboxImagePath} from './paths';

/** The staged inbox image as a data URL, or null when nothing was shared. */
export async function loadInboxAsDataUrl(): Promise<string | null> {
  try {
    const b64 = await Engine.readFileBase64(inboxImagePath());
    if (!b64) {
      return null;
    }
    return `data:image/png;base64,${b64}`;
  } catch {
    return null;
  }
}
