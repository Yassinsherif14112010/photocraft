/**
 * Templates gallery — category chips (Instagram / Facebook / TikTok / YouTube
 * / Business / Marketing / Posters / Flyers / Stories), search, faithful
 * schematic previews (same colors + layout the real recipe produces) and
 * one-tap creation of a genuine editable document through engine commands.
 */
import React, {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {t} from '../i18n';
import {TemplateCategories, Templates} from '../core/Templates';
import type {TemplateCategory, TemplateDef} from '../core/Templates';
import {
  Card,
  Chip,
  FullModal,
  PrimaryButton,
  SearchBar,
  SectionLabel,
  TopBar,
  Badge,
  EmptyState,
  showToast,
} from '../components/ui';
import type {Route} from '../App';

export function TemplatesScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const c = useTheme();
  const s = t();
  const insets = useSafeAreaInsets();
  const [cat, setCat] = useState<TemplateCategory | 'all'>('all');
  const [q, setQ] = useState('');
  const [previewTpl, setPreviewTpl] = useState<TemplateDef | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    const base = q.trim() ? Templates.search(q) : Templates.byCategory(cat);
    return base;
  }, [q, cat]);

  const use = async (tpl: TemplateDef) => {
    setBusy(true);
    try {
      await Templates.create(tpl);
      showToast(`${s.templates.created}: ${tpl.nameAr}`);
      setPreviewTpl(null);
      onNavigate('editor');
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, {backgroundColor: c.bg, paddingTop: insets.top}]}>
      <TopBar title={s.templates.title} subtitle={s.templates.subtitle} onBack={() => onNavigate('home')} />
      <ScrollView contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 24}]}>
        <SearchBar value={q} onChange={setQ} placeholder={s.templates.search} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 6}}>
          <Chip label={s.common.all} small active={cat === 'all'} onPress={() => setCat('all')} />
          {TemplateCategories.map(k => (
            <Chip key={k} label={(s.templates.cats as Record<string, string>)[k]} small active={cat === k} onPress={() => setCat(k)} />
          ))}
        </ScrollView>

        <View style={styles.grid}>
          {list.map(tpl => (
            <Card key={tpl.id} style={{width: '47.5%', padding: 0, overflow: 'hidden'}} onPress={() => setPreviewTpl(tpl)}>
              <TemplatePreview tpl={tpl} />
              <View style={{padding: 10, gap: 3}}>
                <Text style={{color: c.text, fontWeight: '800', fontSize: 13}} numberOfLines={1}>
                  {tpl.nameAr}
                </Text>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                  <Text style={{color: c.textFaint, fontSize: 10.5}}>
                    {tpl.width}×{tpl.height}
                  </Text>
                  <Badge text={(s.templates.cats as Record<string, string>)[tpl.category]} tone="neutral" />
                </View>
              </View>
            </Card>
          ))}
        </View>
        {list.length === 0 && <EmptyState glyph="🗂" title={s.templates.empty} />}
      </ScrollView>

      {/* template detail */}
      <FullModal visible={!!previewTpl} onClose={() => setPreviewTpl(null)} title={previewTpl?.nameAr ?? ''} subtitle={previewTpl?.name}>
        {previewTpl && (
          <ScrollView contentContainerStyle={{gap: 14, padding: 16}}>
            <Card style={{padding: 0, overflow: 'hidden'}}>
              <TemplatePreview tpl={previewTpl} big />
            </Card>
            <View style={{flexDirection: 'row', gap: 6, flexWrap: 'wrap'}}>
              <Badge text={`${previewTpl.width}×${previewTpl.height}`} tone="accent" />
              <Badge text={(s.templates.cats as Record<string, string>)[previewTpl.category]} tone="neutral" />
              <Badge text={previewTpl.layout} tone="warn" />
            </View>
            <SectionLabel text={s.templates.preview} />
            <Text style={{color: c.textDim, fontSize: 12.5}}>
              {previewTpl.headline}
              {previewTpl.sub ? ` — ${previewTpl.sub}` : ''}
            </Text>
            <PrimaryButton label={busy ? s.common.busy : s.templates.use} onPress={() => use(previewTpl)} disabled={busy} />
          </ScrollView>
        )}
      </FullModal>
    </View>
  );
}

/** Schematic preview driven by the recipe data — same colors, same layout. */
function TemplatePreview({tpl, big}: {tpl: TemplateDef; big?: boolean}) {
  const c = useTheme();
  const h = big ? 260 : 110;
  return (
    <View style={[styles.mock, {backgroundColor: tpl.bg, height: h}]}>
      {tpl.layout === 'banner' && <View style={[styles.band, {backgroundColor: tpl.accent, top: '58%'}]} />}
      {tpl.layout === 'split' && <View style={[styles.side, {backgroundColor: tpl.accent}]} />}
      {tpl.layout === 'story' && <View style={[styles.ring, {borderColor: tpl.accent}]} />}
      {tpl.layout === 'bottom' && <View style={[styles.foot, {backgroundColor: tpl.accent}]} />}
      {tpl.layout === 'center' && <View style={[styles.frame, {borderColor: tpl.accent}]} />}
      <View style={[styles.mockInner, {maxWidth: tpl.layout === 'minimal' ? '90%' : '76%'}]}>
        <Pressable>
          <Text style={[styles.mockHead, {color: tpl.fg}]} numberOfLines={3}>
            {tpl.headline}
          </Text>
        </Pressable>
        {tpl.sub ? (
          <Text style={[styles.mockSub, {color: tpl.fg}]} numberOfLines={1}>
            {tpl.sub}
          </Text>
        ) : null}
        <View style={[styles.accentBar, {backgroundColor: tpl.accent}]} />
      </View>
      <View style={styles.checker} pointerEvents="none">
        <Text style={{color: c.textFaint, fontSize: 9}}> </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {padding: 16, gap: 14},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  mock: {overflow: 'hidden', justifyContent: 'center'},
  mockInner: {paddingHorizontal: 16, gap: 4, alignSelf: 'flex-start'},
  mockHead: {fontWeight: '900', fontSize: 16, lineHeight: 20},
  mockSub: {fontWeight: '600', fontSize: 10, opacity: 0.75},
  accentBar: {width: 30, height: 4, borderRadius: 2, marginTop: 6},
  band: {position: 'absolute', start: 0, end: 0, height: '30%', opacity: 0.92},
  side: {position: 'absolute', top: 0, bottom: 0, end: 0, width: '38%', opacity: 0.18},
  ring: {position: 'absolute', width: 90, height: 90, borderRadius: 45, borderWidth: 4, end: -20, top: -20, opacity: 0.8},
  foot: {position: 'absolute', start: 0, end: 0, bottom: 0, height: '28%', opacity: 0.2},
  frame: {position: 'absolute', start: 10, end: 10, top: 10, bottom: 10, borderWidth: 1.5, borderRadius: 8, opacity: 0.8},
  checker: {...StyleSheet.absoluteFillObject, alignItems: 'flex-end', justifyContent: 'flex-end'},
});
