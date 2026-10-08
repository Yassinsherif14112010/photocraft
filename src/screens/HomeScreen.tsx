/**
 * Home — the professional dashboard: continue-editing hero, recent projects
 * (search + tags), templates row, quick create with size presets, module
 * entries (Assets / Brand Kit / Smart Resize / Tutorials) and a theme switch.
 * Projects shown here are real engine-saved files indexed by ProjectsStore.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme, useThemeMode} from '../theme';
import {t} from '../i18n';
import {Editor, openDocument, useEditor} from '../core/DocumentStore';
import {ProjectsStore} from '../core/ProjectsStore';
import type {ProjectMeta} from '../core/ProjectsStore';
import {TEMPLATES} from '../core/Templates';
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  FadeInView,
  GhostButton,
  PrimaryButton,
  SearchBar,
  SectionLabel,
  TextInputRow,
  showToast,
} from '../components/ui';
import type {Route} from '../App';

const SIZE_PRESETS: Array<[number, number, string]> = [
  [1080, 1080, '1:1'],
  [1080, 1920, '9:16'],
  [1200, 630, '1.91:1'],
  [1280, 720, '16:9'],
  [1080, 1350, '4:5'],
];

export function HomeScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const c = useTheme();
  const s = t();
  const insets = useSafeAreaInsets();
  const {width} = useWindowDimensions();
  const st = useEditor();
  const [themeMode, setThemeMode] = useThemeMode();

  const [name, setName] = useState('Untitled');
  const [size, setSize] = useState<[number, number]>([1080, 1080]);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [query, setQuery] = useState('');
  const [continue_, setContinue] = useState<ProjectMeta | null>(null);

  const reload = useCallback(async () => {
    setProjects(await ProjectsStore.search(query));
    setContinue(await ProjectsStore.continueCandidate());
  }, [query]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = async () => {
    await Editor.newDocument(name || 'Untitled', size[0], size[1]);
    onNavigate('editor');
  };

  const openLastImport = async () => {
    try {
      await openDocument('/data/data/com.photocraft.mobile/files/inbox/last.psd');
      onNavigate('editor');
    } catch {
      showToast(s.home.openError, 'error');
    }
  };

  const openProject = async (p: ProjectMeta) => {
    try {
      await openDocument(p.path);
      onNavigate('editor');
    } catch {
      showToast(s.home.openError, 'error');
    }
  };

  const recover = async () => {
    try {
      await openDocument('/data/data/com.photocraft.mobile/files/autosave/current.pcraft');
      onNavigate('editor');
      showToast(s.home.recovered);
    } catch {
      showToast(s.home.openError, 'error');
    }
  };

  const wide = width >= 720;
  const tileW = wide ? '31%' : '47%';

  return (
    <ScrollView style={[styles.root, {backgroundColor: c.bg}]} contentContainerStyle={[styles.content, {paddingTop: insets.top + 12}]}>
      {/* header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.logo, {color: c.text}]}>
            {s.appName}
            <Text style={{color: c.accent}}>.</Text>
          </Text>
          <Text style={[styles.tagline, {color: c.textDim}]}>{s.tagline}</Text>
        </View>
        <View style={{flexDirection: 'row', gap: 6}}>
          <Chip label={s.theme.dark} small active={themeMode === 'dark'} onPress={() => setThemeMode('dark')} />
          <Chip label={s.theme.light} small active={themeMode === 'light'} onPress={() => setThemeMode('light')} />
          <Chip label={s.theme.system} small active={themeMode === 'system'} onPress={() => setThemeMode('system')} />
        </View>
      </View>

      {/* continue editing hero */}
      {continue_ && (
        <FadeInView>
          <Card onPress={continue_.path.endsWith('current.pcraft') ? recover : () => openProject(continue_)} style={styles.hero}>
            <View style={[styles.heroThumb, {backgroundColor: c.surface3}]}>
              <Text style={{color: c.textFaint, fontSize: 26}}>🖼</Text>
            </View>
            <View style={{flex: 1, gap: 4}}>
              <Badge text={s.home.continueEditing} tone="accent" />
              <Text style={{color: c.text, fontWeight: '800', fontSize: 17}} numberOfLines={1}>
                {continue_.name}
              </Text>
              <Text style={{color: c.textDim, fontSize: 12}}>
                {continue_.width} × {continue_.height} · {new Date(continue_.lastOpened).toLocaleDateString()}
              </Text>
            </View>
            <Text style={{color: c.accent2, fontWeight: '800'}}>›</Text>
          </Card>
        </FadeInView>
      )}

      {/* new document */}
      <Card>
        <SectionLabel text={s.home.newDoc} />
        <TextInputRow value={name} onChange={setName} placeholder={s.text.placeholder} />
        <View style={styles.chipRow}>
          {SIZE_PRESETS.map(([w, h, label]) => (
            <Chip
              key={label}
              label={label}
              small
              active={size[0] === w && size[1] === h}
              onPress={() => setSize([w, h])}
            />
          ))}
        </View>
        <Text style={{color: c.textFaint, fontSize: 11}}>
          {s.home.width} {size[0]} · {s.home.height} {size[1]}
        </Text>
        <PrimaryButton label={`${s.home.create} →`} onPress={create} />
        <View style={{flexDirection: 'row', justifyContent: 'center'}}>
          <GhostButton label={`${s.home.open} (PSD/PNG/SVG)`} onPress={openLastImport} />
        </View>
      </Card>

      {/* templates row */}
      <View style={{gap: 10}}>
        <SectionLabel
          text={s.home.templates}
          action={<GhostButton label={s.common.more} onPress={() => onNavigate('templates')} />}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 10}}>
          {TEMPLATES.slice(0, 8).map(tpl => (
            <Card key={tpl.id} style={{width: 130, padding: 0, overflow: 'hidden'}} onPress={() => onNavigate('templates')}>
              <TemplateThumb tpl={tpl} c={c} />
              <View style={{padding: 10, gap: 2}}>
                <Text style={{color: c.text, fontSize: 12, fontWeight: '700'}} numberOfLines={1}>
                  {tpl.nameAr}
                </Text>
                <Text style={{color: c.textFaint, fontSize: 10}}>
                  {tpl.width}×{tpl.height}
                </Text>
              </View>
            </Card>
          ))}
        </ScrollView>
      </View>

      {/* recent projects */}
      <View style={{gap: 10}}>
        <SectionLabel text={s.home.recent} />
        <SearchBar value={query} onChange={setQuery} placeholder={s.home.searchProjects} />
        {projects.length === 0 && <EmptyState glyph="🗂" title={s.home.emptyRecents} />}
        {projects.slice(0, 8).map(p => (
          <Card key={p.id} onPress={() => openProject(p)} style={styles.projectRow}>
            <View style={[styles.projectThumb, {backgroundColor: c.surface3}]}>
              <Text style={{color: c.textFaint, fontSize: 16}}>🖼</Text>
            </View>
            <View style={{flex: 1, gap: 2}}>
              <Text style={{color: c.text, fontWeight: '700', fontSize: 14}} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={{color: c.textDim, fontSize: 11}}>
                {p.width} × {p.height} · {new Date(p.lastOpened).toLocaleString()}
              </Text>
              {p.tags.length > 0 && (
                <View style={{flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginTop: 2}}>
                  {p.tags.map(tag => (
                    <Badge key={tag} text={tag} tone="neutral" />
                  ))}
                </View>
              )}
            </View>
            {p.path.endsWith('current.pcraft') && <Badge text={s.home.autoSaved} tone="success" />}
          </Card>
        ))}
      </View>

      {/* module grid */}
      <View style={[styles.grid, {gap: 12}]}>
        <ModuleTile glyph="🧩" label={s.home.assets} sub={s.assets.subtitle} onPress={() => onNavigate('assets')} c={c} w={tileW} />
        <ModuleTile glyph="🎨" label={s.home.brandKit} sub={s.brand.subtitle} onPress={() => onNavigate('brand')} c={c} w={tileW} />
        <ModuleTile glyph="📐" label={s.home.smartResize} sub={s.smart.subtitle} onPress={() => onNavigate('smart')} c={c} w={tileW} />
        <ModuleTile glyph="🎓" label={s.home.tutorials} sub={s.tutorials.subtitle} onPress={() => onNavigate('tutorials')} c={c} w={tileW} />
      </View>

      {/* resume session shortcut when a doc is already open */}
      {st.sessionId != null && (
        <PrimaryButton label={`${s.home.continueEditing} →`} onPress={() => onNavigate('editor')} />
      )}
    </ScrollView>
  );
}

function TemplateThumb({tpl, c}: {tpl: (typeof TEMPLATES)[number]; c: ReturnType<typeof useTheme>}) {
  // Faithful schematic of the real recipe (same colors/layout as the result).
  return (
    <View style={[styles.tplThumb, {backgroundColor: tpl.bg}]}>
      {tpl.layout === 'banner' && <View style={[styles.tplBand, {backgroundColor: tpl.accent, top: '60%'}]} />}
      {tpl.layout === 'split' && <View style={[styles.tplSide, {backgroundColor: tpl.accent}]} />}
      {tpl.layout === 'story' && (
        <View style={[styles.tplRing, {borderColor: tpl.accent}]} />
      )}
      {tpl.layout === 'bottom' && <View style={[styles.tplFoot, {backgroundColor: tpl.accent, bottom: 0}]} />}
      {tpl.layout === 'center' && <View style={[styles.tplFrame, {borderColor: tpl.accent}]} />}
      <Text style={[styles.tplText, {color: tpl.fg}]} numberOfLines={2}>
        {tpl.headline}
      </Text>
      <View style={[styles.tplBar, {backgroundColor: c.border}]} />
    </View>
  );
}

function ModuleTile({glyph, label, sub, onPress, c, w}: {glyph: string; label: string; sub: string; onPress: () => void; c: ReturnType<typeof useTheme>; w: string}) {
  return (
    <Card onPress={onPress} style={{width: w as any, flex: 1, minWidth: 150, flexGrow: 1}}>
      <Text style={{fontSize: 26}}>{glyph}</Text>
      <Text style={{color: c.text, fontWeight: '800', marginTop: 6}}>{label}</Text>
      <Text style={{color: c.textDim, fontSize: 11, marginTop: 2}} numberOfLines={2}>
        {sub}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {padding: 20, gap: 18, paddingBottom: 40},
  header: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10},
  logo: {fontSize: 34, fontWeight: '900', letterSpacing: -0.5},
  tagline: {fontSize: 13, marginTop: 2},
  hero: {flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12},
  heroThumb: {width: 62, height: 62, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  projectRow: {flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10},
  projectThumb: {width: 46, height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center'},
  grid: {flexDirection: 'row', flexWrap: 'wrap'},
  tplThumb: {height: 92, padding: 8, overflow: 'hidden'},
  tplBand: {position: 'absolute', start: 0, end: 0, height: '28%', opacity: 0.9},
  tplSide: {position: 'absolute', top: 0, bottom: 0, end: 0, width: '30%', opacity: 0.25},
  tplRing: {position: 'absolute', width: 54, height: 54, borderRadius: 27, borderWidth: 3, end: 6, top: 6, opacity: 0.8},
  tplFoot: {position: 'absolute', start: 0, end: 0, height: '30%', opacity: 0.2},
  tplFrame: {position: 'absolute', start: 6, end: 6, top: 6, bottom: 6, borderWidth: 1.5, borderRadius: 6, opacity: 0.7},
  tplText: {fontWeight: '800', fontSize: 11, maxWidth: '80%'},
  tplBar: {width: 26, height: 3, borderRadius: 2, marginTop: 4},
});
