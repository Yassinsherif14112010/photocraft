/**
 * Asset Library — bundled icons/shapes/stickers + user assets, with search,
 * categories, favorites, tags, recents, import, delete, update, metadata and
 * real rendered thumbnails. Assets are real SVG sources (read from the bundled
 * Android assets through PhotoCraftAssets, with an inline fallback); placing
 * one creates true vector layers through the engine's `svg.importText`. User
 * PNG/JPEG imports are placed as raster layers via `file.placeEmbedded`.
 * Favorites/recents/tags persist in AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {SvgEngine} from './SvgEngine';
import {Editor, getState} from '../DocumentStore';
import {Engine, Assets as NativeAssets} from '../../native/PhotoCraftEngine';

export type AssetCategory = 'icons' | 'shapes' | 'stickers' | 'user';

export interface AssetItem {
  id: string;
  name: string;
  nameAr: string;
  category: AssetCategory;
  tags: string[];
  /** Bundled asset path (inside asset-library/) or user file path. */
  source: string;
  addedAt?: number;
}

const KEY_FAV = 'pc.assets.favorites';
const KEY_RECENT = 'pc.assets.recents';
const KEY_USER = 'pc.assets.user';
const KEY_TAGS = 'pc.assets.tags';

/** Bundled library — real SVG sources ship in android assets (asset-library/). */
export const BUNDLED_ASSETS: AssetItem[] = [
  {id: 'ic-star', name: 'Star', nameAr: 'نجمة', category: 'icons', tags: ['star', 'rate', 'favorite'], source: 'icons/star.svg'},
  {id: 'ic-heart', name: 'Heart', nameAr: 'قلب', category: 'icons', tags: ['heart', 'like', 'love'], source: 'icons/heart.svg'},
  {id: 'ic-bolt', name: 'Bolt', nameAr: 'برق', category: 'icons', tags: ['bolt', 'flash', 'energy'], source: 'icons/bolt.svg'},
  {id: 'ic-badge', name: 'Verified Badge', nameAr: 'شارة توثيق', category: 'icons', tags: ['badge', 'check', 'verified'], source: 'icons/badge.svg'},
  {id: 'ic-bubble', name: 'Speech Bubble', nameAr: 'فقاعة كلام', category: 'icons', tags: ['chat', 'bubble', 'speech'], source: 'icons/bubble.svg'},
  {id: 'ic-camera', name: 'Camera', nameAr: 'كاميرا', category: 'icons', tags: ['camera', 'photo'], source: 'icons/camera.svg'},
  {id: 'sh-circle', name: 'Circle', nameAr: 'دائرة', category: 'shapes', tags: ['circle', 'round'], source: 'shapes/circle.svg'},
  {id: 'sh-triangle', name: 'Triangle', nameAr: 'مثلث', category: 'shapes', tags: ['triangle'], source: 'shapes/triangle.svg'},
  {id: 'sh-arrow', name: 'Arrow', nameAr: 'سهم', category: 'shapes', tags: ['arrow', 'pointer'], source: 'shapes/arrow.svg'},
  {id: 'sh-banner', name: 'Banner', nameAr: 'لافتة', category: 'shapes', tags: ['banner', 'ribbon'], source: 'shapes/banner.svg'},
  {id: 'st-sale', name: 'Sale Tag', nameAr: 'تخفيضات', category: 'stickers', tags: ['sale', 'offer', 'discount'], source: 'stickers/sale.svg'},
  {id: 'st-new', name: 'New!', nameAr: 'جديد!', category: 'stickers', tags: ['new', 'label'], source: 'stickers/new.svg'},
  {id: 'st-open', name: 'Open 24/7', nameAr: 'مفتوح ٢٤ ساعة', category: 'stickers', tags: ['open', 'hours', 'shop'], source: 'stickers/open.svg'},
];

/** In-memory thumbnail cache (data URLs rendered by the engine). */
const thumbCache = new Map<string, string>();

export const AssetLibrary = {
  async all(): Promise<AssetItem[]> {
    const user = await AssetLibrary.userAssets();
    return [...user, ...BUNDLED_ASSETS];
  },

  /** User-imported assets (real files in app storage). */
  async userAssets(): Promise<AssetItem[]> {
    return JSON.parse((await AsyncStorage.getItem(KEY_USER)) ?? '[]') as AssetItem[];
  },

  async search(query: string, category?: AssetCategory): Promise<AssetItem[]> {
    const all = await AssetLibrary.all();
    const q = query.trim().toLowerCase();
    return all.filter(a => {
      if (category && a.category !== category) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        a.name.toLowerCase().includes(q) ||
        a.nameAr.includes(query) ||
        a.tags.some(t => t.toLowerCase().includes(q))
      );
    });
  },

  async categories(): Promise<AssetCategory[]> {
    return ['icons', 'shapes', 'stickers', 'user'];
  },

  // ------------------------------------------------------------- favorites

  async favorites(): Promise<string[]> {
    return JSON.parse((await AsyncStorage.getItem(KEY_FAV)) ?? '[]');
  },

  async toggleFavorite(id: string): Promise<boolean> {
    const favs = new Set(await AssetLibrary.favorites());
    if (favs.has(id)) {
      favs.delete(id);
    } else {
      favs.add(id);
    }
    await AsyncStorage.setItem(KEY_FAV, JSON.stringify([...favs]));
    return favs.has(id);
  },

  // ----------------------------------------------------------------- recents

  async recents(): Promise<string[]> {
    return JSON.parse((await AsyncStorage.getItem(KEY_RECENT)) ?? '[]');
  },

  async pushRecent(id: string) {
    const rec = (await AssetLibrary.recents()).filter(r => r !== id);
    rec.unshift(id);
    await AsyncStorage.setItem(KEY_RECENT, JSON.stringify(rec.slice(0, 20)));
  },

  // -------------------------------------------------------------------- tags

  /** Extra tags keyed by asset id (merged over the built-in tags). */
  async tags(): Promise<Record<string, string[]>> {
    return JSON.parse((await AsyncStorage.getItem(KEY_TAGS)) ?? '{}');
  },

  async setTags(id: string, tags: string[]): Promise<void> {
    const all = await AssetLibrary.tags();
    all[id] = tags;
    await AsyncStorage.setItem(KEY_TAGS, JSON.stringify(all));
  },

  // ---------------------------------------------------------------- user CRUD

  /** Register a user asset from a picked/copied file path. */
  async addUserAsset(path: string, name: string, tags: string[] = []): Promise<AssetItem> {
    const item: AssetItem = {
      id: `user-${Date.now()}`,
      name,
      nameAr: name,
      category: 'user',
      tags: ['user', ...tags],
      source: path,
      addedAt: Date.now(),
    };
    const list = await AssetLibrary.userAssets();
    list.unshift(item);
    await AsyncStorage.setItem(KEY_USER, JSON.stringify(list));
    return item;
  },

  /** Rename / re-tag a user asset. */
  async updateUserAsset(id: string, patch: {name?: string; tags?: string[]}): Promise<AssetItem | null> {
    const list = await AssetLibrary.userAssets();
    const idx = list.findIndex(a => a.id === id);
    if (idx < 0) {
      return null;
    }
    if (patch.name !== undefined) {
      list[idx].name = patch.name;
      list[idx].nameAr = patch.name;
    }
    if (patch.tags !== undefined) {
      list[idx].tags = ['user', ...patch.tags];
    }
    await AsyncStorage.setItem(KEY_USER, JSON.stringify(list));
    return list[idx];
  },

  /** Remove a user asset (the file itself is kept on disk). */
  async deleteUserAsset(id: string): Promise<boolean> {
    const list = await AssetLibrary.userAssets();
    const next = list.filter(a => a.id !== id);
    if (next.length === list.length) {
      return false;
    }
    await AsyncStorage.setItem(KEY_USER, JSON.stringify(next));
    const favs = await AssetLibrary.favorites();
    if (favs.includes(id)) {
      await AsyncStorage.setItem(KEY_FAV, JSON.stringify(favs.filter(f => f !== id)));
    }
    return true;
  },

  // ------------------------------------------------------------------ place

  /** Place an asset into the document (SVG → vector layers, image → raster). */
  async place(asset: AssetItem, centerX: number, centerY: number, size = 320): Promise<number> {
    await AssetLibrary.pushRecent(asset.id);
    const {doc} = getState();
    if (!doc) {
      throw new Error('no document open');
    }
    if (asset.category === 'user' || asset.source.endsWith('.png') || asset.source.endsWith('.jpg')) {
      const reply = await Editor.runCommand('file.placeEmbedded', {
        path: asset.source,
        fit: false,
        center: [centerX, centerY],
      });
      const id = reply.layer as number;
      await Editor.runCommand('layer.setProps', {layer: id, name: asset.name});
      return id;
    }
    const svg = await readBundledSvg(asset.source);
    // Scale the 512-unit viewBox art to `size` on the canvas.
    const scale = size / 512;
    const reply = await Editor.runCommand('svg.importText', {
      svg,
      name: asset.name,
      x: centerX - (size / 2),
      y: centerY - (size / 2),
      scale,
    });
    return reply.layer;
  },

  /**
   * Real thumbnail: rendered by a throwaway engine session
   * (svg.importText → renderThumbnail), cached per asset.
   */
  async thumbnail(asset: AssetItem, maxSide = 96): Promise<string | null> {
    const cached = thumbCache.get(asset.id);
    if (cached) {
      return cached;
    }
    if (asset.category === 'user') {
      return null; // user images render through their own <Image> source
    }
    try {
      const svg = await readBundledSvg(asset.source);
      const {sessionId} = await Engine.engineCommands();
      try {
        await Engine.call(sessionId, 'doc.new', {name: 'thumb', width: 128, height: 128, background: 'transparent', resolution: 72});
        await Engine.execute(sessionId, 'svg.importText', {svg, name: asset.name, x: 8, y: 8, scale: 112 / 512});
        const thumb = await Engine.renderThumbnail(sessionId, maxSide);
        thumbCache.set(asset.id, thumb);
        return thumb;
      } finally {
        await Engine.closeSession(sessionId);
      }
    } catch {
      return null;
    }
  },

  /** Asset metadata card (category, tags, source, times used). */
  async metadata(asset: AssetItem) {
    const tags = await AssetLibrary.tags();
    const favs = await AssetLibrary.favorites();
    const rec = await AssetLibrary.recents();
    return {
      ...asset,
      effectiveTags: [...asset.tags, ...(tags[asset.id] ?? [])],
      favorite: favs.includes(asset.id),
      lastUsedAt: rec.includes(asset.id) ? rec : null,
      uses: rec.filter(r => r === asset.id).length,
    };
  },
};

/** Read a bundled SVG from Android assets (fallback: inline map). */
async function readBundledSvg(rel: string): Promise<string> {
  try {
    if (NativeAssets?.readAsset) {
      return await NativeAssets.readAsset(`asset-library/${rel}`);
    }
  } catch {
    /* fall through to inline map */
  }
  return INLINE_SVGS[rel] ?? INLINE_SVGS['shapes/circle.svg'];
}

/** Inline fallbacks (same content as the bundled files). */
export const INLINE_SVGS: Record<string, string> = {
  'icons/star.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M256 32l64 148 160 14-121 106 36 158-139-82-139 82 36-158L32 194l160-14z"/></svg>',
  'icons/heart.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M256 464l-46-42C96 322 32 264 32 192c0-64 50-112 112-112 36 0 70 17 92 44 22-27 56-44 92-44 62 0 112 48 112 112 0 72-64 130-178 230z"/></svg>',
  'icons/bolt.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M288 32L128 288h96l-32 192 192-288h-96z"/></svg>',
  'icons/badge.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="224" fill="#2563EB"/><path d="M160 264l64 64 128-128" stroke="#fff" stroke-width="40" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'icons/bubble.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M256 64c132 0 224 84 224 192s-92 192-224 192c-24 0-47-3-69-8l-107 48 26-92C66 355 32 290 32 256 32 148 124 64 256 64z"/></svg>',
  'icons/camera.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M192 96l-24 48H96a64 64 0 00-64 64v160a64 64 0 0064 64h320a64 64 0 0064-64V208a64 64 0 00-64-64h-72l-24-48z"/><circle cx="256" cy="288" r="88" fill="#fff"/></svg>',
  'shapes/circle.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="224" fill="none" stroke="currentColor" stroke-width="32"/></svg>',
  'shapes/triangle.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M256 48l208 384H48z" fill="none" stroke="currentColor" stroke-width="32" stroke-linejoin="round"/></svg>',
  'shapes/arrow.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M64 256h320m-96-96l96 96-96 96" fill="none" stroke="currentColor" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'shapes/banner.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M32 128h448v192L256 448 32 320z" fill="none" stroke="currentColor" stroke-width="32" stroke-linejoin="round"/></svg>',
  'stickers/sale.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M64 160l192-96 192 96v192l-192 96-192-96z" fill="#F59E0B"/><text x="256" y="300" font-family="sans-serif" font-size="120" font-weight="bold" text-anchor="middle" fill="#fff">SALE</text></svg>',
  'stickers/new.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect x="48" y="176" width="416" height="160" rx="32" fill="#10B981"/><text x="256" y="290" font-family="sans-serif" font-size="104" font-weight="bold" text-anchor="middle" fill="#fff">NEW</text></svg>',
  'stickers/open.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="224" fill="#0EA5E9"/><text x="256" y="240" font-family="sans-serif" font-size="88" font-weight="bold" text-anchor="middle" fill="#fff">OPEN</text><text x="256" y="340" font-family="sans-serif" font-size="72" font-weight="bold" text-anchor="middle" fill="#fff">24/7</text></svg>',
};
