/**
 * Asset Library — bundled icons/shapes/stickers + user assets, with search,
 * categories, favorites and recents. Assets are real SVG sources; adding one
 * creates true vector layers through the SVG engine. User-imported PNGs become
 * raster layers. Metadata (favorites/recents) persists in AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {SvgEngine} from './SvgEngine';
import {Editor} from '../DocumentStore';

export type AssetCategory = 'icons' | 'shapes' | 'stickers' | 'user';

export interface AssetItem {
  id: string;
  name: string;
  nameAr: string;
  category: AssetCategory;
  tags: string[];
  /** Bundled require() key or user file path. */
  source: string;
}

const KEY_FAV = 'pc.assets.favorites';
const KEY_RECENT = 'pc.assets.recents';

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

export const AssetLibrary = {
  all: (): AssetItem[] => BUNDLED_ASSETS,

  async search(query: string, category?: AssetCategory): Promise<AssetItem[]> {
    const q = query.trim().toLowerCase();
    return BUNDLED_ASSETS.filter(a => {
      if (category && a.category !== category) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        a.name.toLowerCase().includes(q) ||
        a.nameAr.includes(query) ||
        a.tags.some(t => t.includes(q))
      );
    });
  },

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

  async recents(): Promise<string[]> {
    return JSON.parse((await AsyncStorage.getItem(KEY_RECENT)) ?? '[]');
  },

  async pushRecent(id: string) {
    const rec = (await AssetLibrary.recents()).filter(r => r !== id);
    rec.unshift(id);
    await AsyncStorage.setItem(KEY_RECENT, JSON.stringify(rec.slice(0, 20)));
  },

  /** Place an asset into the document (SVG → vector layers, PNG → raster). */
  async place(asset: AssetItem, centerX: number, centerY: number, size = 320): Promise<number> {
    await AssetLibrary.pushRecent(asset.id);
    if (asset.category === 'user' || asset.source.endsWith('.png')) {
      const reply = await Editor.runCommand('layer.addRasterFile', {
        path: asset.source,
        x: centerX - size / 2,
        y: centerY - size / 2,
      });
      return reply.id;
    }
    const svg = await readBundledSvg(asset.source);
    const report = await SvgEngine.importText(svg, asset.name);
    await Editor.runCommand('layer.transform', {
      id: report.layerId,
      scale: size / 512,
      anchor: 'center',
      x: centerX,
      y: centerY,
    });
    return report.layerId;
  },

  /** Register a user asset (imported image path). */
  async addUserAsset(path: string, name: string, tags: string[] = []): Promise<AssetItem> {
    const item: AssetItem = {
      id: `user-${Date.now()}`,
      name,
      nameAr: name,
      category: 'user',
      tags: ['user', ...tags],
      source: path,
    };
    const list = JSON.parse((await AsyncStorage.getItem('pc.assets.user')) ?? '[]');
    list.unshift(item);
    await AsyncStorage.setItem('pc.assets.user', JSON.stringify(list));
    return item;
  },
};

/** Read a bundled SVG from Android assets (fallback: inline map). */
async function readBundledSvg(rel: string): Promise<string> {
  try {
    const RNFS = require('react-native').NativeModules?.PhotoCraftAssets;
    if (RNFS?.readAsset) {
      return await RNFS.readAsset(`asset-library/${rel}`);
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
