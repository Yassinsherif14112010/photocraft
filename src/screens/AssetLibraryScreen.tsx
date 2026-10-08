/** Asset Library screen — categories, search, favorites, place into document. */
import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {theme} from '../theme';
import {t} from '../i18n';
import {AssetLibrary} from '../core/engines/AssetLibrary';
import type {AssetCategory, AssetItem} from '../core/engines/AssetLibrary';
import type {Route} from '../App';

export function AssetLibraryScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const s = t();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<AssetCategory>('icons');
  const [items, setItems] = useState<AssetItem[]>([]);
  const [favs, setFavs] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setItems(await AssetLibrary.search(q, cat));
      setFavs(new Set(await AssetLibrary.favorites()));
    })();
  }, [q, cat]);

  const place = async (item: AssetItem) => {
    await AssetLibrary.place(item, 540, 540);
    onNavigate('editor');
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

  const cats: Array<[AssetCategory, string]> = [
    ['icons', s.assets.icons],
    ['shapes', s.assets.shapes],
    ['stickers', s.assets.stickers],
    ['user', s.assets.user],
  ];

  return (
    <View style={styles.root}>
      <Text style={styles.h1}>{s.assets.title}</Text>
      <TextInput style={styles.input} value={q} onChangeText={setQ} placeholder={s.assets.search} placeholderTextColor={theme.textDim} />
      <View style={styles.row}>
        {cats.map(([c, label]) => (
          <Pressable key={c} style={[styles.chip, cat === c && styles.chipOn]} onPress={() => setCat(c)}>
            <Text style={[styles.chipText, cat === c && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.grid}>
        {items.map(item => (
          <Pressable key={item.id} style={styles.card} onPress={() => place(item)}>
            <Text style={styles.icon}>{item.category === 'icons' ? '✦' : item.category === 'shapes' ? '⬟' : item.category === 'stickers' ? '🏷' : '🖼'}</Text>
            <Text style={styles.name}>{item.nameAr}</Text>
            <Pressable onPress={() => fav(item)} hitSlop={6}>
              <Text style={styles.fav}>{favs.has(item.id) ? '★' : '☆'}</Text>
            </Pressable>
          </Pressable>
        ))}
        {items.length === 0 && <Text style={styles.dim}>{s.assets.search}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg, padding: 20, gap: 10},
  h1: {color: theme.text, fontSize: 26, fontWeight: '800'},
  input: {
    backgroundColor: theme.surface2, color: theme.text, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  row: {flexDirection: 'row', gap: 8},
  chip: {paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.surface2},
  chipOn: {backgroundColor: theme.accent},
  chipText: {color: theme.textDim, fontSize: 12, fontWeight: '600'},
  chipTextOn: {color: '#fff'},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 20},
  card: {
    width: '31%', backgroundColor: theme.surface, borderRadius: theme.radius,
    padding: 12, gap: 6, borderWidth: 1, borderColor: theme.border,
  },
  icon: {fontSize: 30, color: theme.accent2},
  name: {color: theme.text, fontSize: 12, fontWeight: '600'},
  fav: {color: theme.warn, fontSize: 16, position: 'absolute', top: 8, right: 8},
  dim: {color: theme.textDim},
});
