/**
 * Asset Library — a marketplace-grade, fully offline library: hero search,
 * category chips (icons / shapes / stickers / logos / frames / social /
 * decorative / uploads), favorites + recents + trending rails, tag-driven
 * collections, engine-rendered thumbnails, quick preview modal, tag editing
 * for uploads, import from device and delete for user assets.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {t} from '../i18n';
import {AssetLibrary} from '../core/engines/AssetLibrary';
import type {AssetCategory, AssetItem} from '../core/engines/AssetLibrary';
import {FileIO} from '../native/PhotoCraftEngine';
import {getState} from '../core/DocumentStore';
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  FullModal,
  PrimaryButton,
  SectionLabel,
  SearchBar,
  TextInputRow,
  TopBar,
  showToast,
} from '../components/ui';
import type {Route} from '../App';

interface Collection {
  tag: string;
  items: AssetItem[];
}

export function AssetLibraryScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const c = useTheme();
  const s = t();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<AssetCategory | 'all'>('all');
  const [items, setItems] = useState<AssetItem[]>([]);
  const [trending, setTrending] = useState<AssetItem[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [favsOnly, setFavsOnly] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<AssetItem | null>(null);
  const [tagDraft, setTagDraft] = useState('');

  const cats: Array<[AssetCategory | 'all', string]> = [
    ['all', s.common.all],
    ['icons', s.assets.icons],
    ['shapes', s.assets.shapes],
    ['stickers', s.assets.stickers],
    ['logos', s.assets.logos],
    ['frames', s.assets.frames],
    ['social', s.assets.social],
    ['decorative', s.assets.decorative],
    ['user', s.assets.user],
  ];

  const load = useCallback(async () => {
    let list = await AssetLibrary.search(q, cat === 'all' ? undefined : cat);
    if (favsOnly) {
      const favSet = new Set(await AssetLibrary.favorites());
      list = list.filter(a => favSet.has(a.id));
    }
    setItems(list);
    setFavs(new Set(await AssetLibrary.favorites()));
    setTrending(await AssetLibrary.trending());
    setCollections(await AssetLibrary.collections());
    for (const item of list.slice(0, 30)) {
      AssetLibrary.thumbnail(item, 128)
        .then(url => {
          if (url) {
            setThumbs(prev => ({...prev, [item.id]: url}));
          }
        })
        .catch(() => {});
    }
  }, [q, cat, favsOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const place = async (item: AssetItem) => {
    try {
      const doc = getState().doc;
      await AssetLibrary.place(item, Math.round((doc?.width ?? 1080) / 2), Math.round((doc?.height ?? 1080) / 2));
      showToast(s.assets.placed);
      load();
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  const fav = async (item: AssetItem) => {
    await AssetLibrary.toggleFavorite(item.id);
    load();
  };

  const importAsset = async () => {
    if (!FileIO?.copyUriToCache) {
      showToast(s.common.error, 'error');
      return;
    }
    try {
      const path = await FileIO.copyUriToCache('', `import-${Date.now()}.png`);
      await AssetLibrary.addUserAsset(path, path.split('/').pop() ?? 'Import');
      showToast(s.assets.imported);
      load();
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  const removeUserAsset = async (item: AssetItem) => {
    await AssetLibrary.deleteUserAsset(item.id);
    setPreview(null);
    showToast(s.assets.deleteAsset);
    load();
  };

  const saveTags = async () => {
    if (!preview) {
      return;
    }
    await AssetLibrary.setTags(preview.id, tagDraft.split(',').map(x => x.trim()).filter(Boolean));
    showToast(s.assets.tags);
    load();
    setPreview(null);
  };

  const AssetCard = ({item, size = '30%'}: {item: AssetItem; size?: string | number}) => (
    <Pressable
      style={[styles.card, {backgroundColor: c.surface, borderColor: c.border, width: size as any}]}
      onPress={() => setPreview(item)}>
      <View style={[styles.thumb, {backgroundColor: c.checker}]}>
        {thumbs[item.id] ? (
          <Image source={{uri: thumbs[item.id]}} style={styles.thumbImg} resizeMode="contain" />
        ) : (
          <Text style={{color: c.textFaint, fontSize: 22}}>❖</Text>
        )}
      </View>
      <Text style={{color: c.text, fontSize: 11.5, fontWeight: '700'}} numberOfLines={1}>
        {item.nameAr}
      </Text>
      <Pressable onPress={() => fav(item)} hitSlop={6} style={styles.fav}>
        <Text style={{color: favs.has(item.id) ? c.warn : c.textFaint, fontSize: 14}}>{favs.has(item.id) ? '★' : '☆'}</Text>
      </Pressable>
    </Pressable>
  );

  return (
    <View style={[styles.root, {backgroundColor: c.bg, paddingTop: insets.top}]}>
      <TopBar title={s.assets.title} subtitle={s.assets.subtitle} onBack={() => onNavigate('home')} />
      <ScrollView contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 24}]}>
        <SearchBar value={q} onChange={setQ} placeholder={s.assets.search} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 6}}>
          {cats.map(([id, label]) => (
            <Chip key={id} label={label} small active={cat === id} onPress={() => setCat(id)} />
          ))}
          <Chip label={s.assets.filterFav} small active={favsOnly} onPress={() => setFavsOnly(!favsOnly)} />
        </ScrollView>

        {/* trending rail */}
        {trending.length > 0 && (
          <View style={{gap: 8}}>
            <SectionLabel text={`🔥 ${s.assets.trending}`} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 10}}>
              {trending.map(item => (
                <AssetCard key={`tr-${item.id}`} item={item} size={116} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* collections */}
        {collections.length > 0 && cat === 'all' && !q && (
          <View style={{gap: 8}}>
            <SectionLabel text={s.assets.collections} />
            {collections.slice(0, 4).map(coll => (
              <Card key={coll.tag} style={{gap: 8}}>
                <Badge text={`#${coll.tag}`} tone="accent" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 10}}>
                  {coll.items.map(item => (
                    <AssetCard key={`co-${item.id}`} item={item} size={104} />
                  ))}
                </ScrollView>
              </Card>
            ))}
          </View>
        )}

        {/* main grid */}
        <SectionLabel text={`${items.length} · ${s.assets.title}`} />
        <View style={styles.grid}>
          {items.map(item => (
            <AssetCard key={item.id} item={item} />
          ))}
        </View>
        {items.length === 0 && <EmptyState glyph="❖" title={s.assets.empty} />}

        <PrimaryButton label={s.assets.importAsset} onPress={importAsset} tone="neutral" />
      </ScrollView>

      {/* preview / detail modal */}
      <FullModal visible={!!preview} onClose={() => setPreview(null)} title={preview?.nameAr ?? ''} subtitle={preview?.name}>
        {preview && (
          <View style={{gap: 14, padding: 16}}>
            <View style={[styles.previewBig, {backgroundColor: c.checker, borderColor: c.border}]}>
              {thumbs[preview.id] ? (
                <Image source={{uri: thumbs[preview.id]}} style={styles.thumbImg} resizeMode="contain" />
              ) : (
                <Text style={{color: c.textFaint, fontSize: 42}}>❖</Text>
              )}
            </View>
            <View style={{flexDirection: 'row', gap: 6, flexWrap: 'wrap'}}>
              {preview.tags.map(tag => (
                <Badge key={tag} text={`#${tag}`} tone="neutral" />
              ))}
              <Badge text={preview.category} tone="accent" />
            </View>
            <View style={{flexDirection: 'row', gap: 8, alignItems: 'center'}}>
              <View style={{flex: 1}}>
                <TextInputRow value={tagDraft} onChange={setTagDraft} placeholder={s.assets.tagsHint} />
              </View>
              <Chip label={s.common.save} onPress={saveTags} />
            </View>
            <PrimaryButton label={s.assets.place} onPress={() => place(preview)} />
            {preview.category === 'user' && (
              <PrimaryButton label={s.assets.deleteAsset} tone="danger" onPress={() => removeUserAsset(preview)} />
            )}
          </View>
        )}
      </FullModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {padding: 16, gap: 14},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  card: {borderRadius: 13, borderWidth: 1, padding: 8, gap: 6},
  thumb: {height: 72, borderRadius: 9, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'},
  thumbImg: {width: '100%', height: '100%'},
  fav: {position: 'absolute', top: 10, end: 10},
  previewBig: {height: 220, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center'},
});
