/**
 * AssetsSheet — the in-editor asset browser: category chips, search,
 * favorites, recents and real engine-rendered SVG thumbnails. Placing an
 * asset runs the real import pipeline (svg.importText / file.placeEmbedded).
 */
import React, {useEffect, useState} from 'react';
import {Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../theme';
import {t} from '../i18n';
import {AssetLibrary} from '../core/engines/AssetLibrary';
import type {AssetCategory, AssetItem} from '../core/engines/AssetLibrary';
import {SearchBar, Chip, EmptyState, SectionLabel, showToast} from './ui';

export function AssetsSheet({onDone}: {onDone?: () => void}) {
  const c = useTheme();
  const s = t();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<AssetCategory | 'all'>('all');
  const cats: Array<[AssetCategory | 'all', string]> = [
    ['all', s.common.all],
    ['icons', s.assets.icons],
    ['shapes', s.assets.shapes],
    ['stickers', s.assets.stickers],
    ['user', s.assets.user],
  ];
  const [items, setItems] = useState<AssetItem[]>([]);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    const list = cat === 'all' ? await AssetLibrary.search(q) : await AssetLibrary.search(q, cat);
    setItems(list);
    setFavs(new Set(await AssetLibrary.favorites()));
    // real thumbnails, lazily
    for (const item of list.slice(0, 24)) {
      AssetLibrary.thumbnail(item, 96)
        .then(url => {
          if (url) {
            setThumbs(prev => ({...prev, [item.id]: url}));
          }
        })
        .catch(() => {});
    }
  }, [q, cat]);

  useEffect(() => {
    load();
  }, [load]);

  const place = async (item: AssetItem) => {
    try {
      await AssetLibrary.place(item, 540, 540);
      await AssetLibrary.pushRecent(item.id);
      showToast(s.assets.placed);
      onDone?.();
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  const fav = async (item: AssetItem) => {
    const on = await AssetLibrary.toggleFavorite(item.id);
    setFavs(prev => {
      const next = new Set(prev);
      if (on) {
        next.add(item.id);
      } else {
        next.delete(item.id);
      }
      return next;
    });
  };

  return (
    <View style={{flex: 1, gap: 10}}>
      <SearchBar value={q} onChange={setQ} placeholder={s.assets.search} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 6}}>
        {cats.map(([id, label]) => (
          <Chip key={id} label={label} small active={cat === id} onPress={() => setCat(id)} />
        ))}
      </ScrollView>
      <SectionLabel text={`${items.length} ${s.assets.title}`} />
      <ScrollView contentContainerStyle={styles.grid}>
        {items.map(item => (
          <Pressable key={item.id} style={[styles.card, {backgroundColor: c.surface, borderColor: c.border}]} onPress={() => place(item)}>
            <View style={[styles.thumb, {backgroundColor: c.checker}]}>
              {thumbs[item.id] ? (
                <Image source={{uri: thumbs[item.id]}} style={styles.thumbImg} resizeMode="contain" />
              ) : (
                <Text style={{color: c.textFaint, fontSize: 20}}>❖</Text>
              )}
            </View>
            <Text style={{color: c.text, fontSize: 11, fontWeight: '700'}} numberOfLines={1}>
              {item.nameAr}
            </Text>
            <Pressable onPress={() => fav(item)} hitSlop={6} style={styles.fav}>
              <Text style={{color: favs.has(item.id) ? c.warn : c.textFaint, fontSize: 13}}>{favs.has(item.id) ? '★' : '☆'}</Text>
            </Pressable>
          </Pressable>
        ))}
        {items.length === 0 && <EmptyState glyph="❖" title={s.assets.empty} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 16},
  card: {width: '30%', borderRadius: 12, borderWidth: 1, padding: 8, gap: 6},
  thumb: {height: 64, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'},
  thumbImg: {width: '100%', height: '100%'},
  fav: {position: 'absolute', top: 10, end: 10},
});
