/**
 * Home — the professional dashboard: continue-editing hero, recent projects
 * (search + tags + real engine-rendered thumbnails + manage actions), the
 * template row, quick create with size presets, real file import
 * (PSD/PSB/PNG/JPG/WebP/SVG via the system picker), export history, module
 * entries and a theme switch. Projects shown here are real engine-saved
 * files indexed by ProjectsStore.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme, useThemeMode} from '../theme';
import {t} from '../i18n';
import {Editor, openDocument, useEditor} from '../core/DocumentStore';
import {ProjectsStore} from '../core/ProjectsStore';
import type {ProjectMeta} from '../core/ProjectsStore';
import {autosavePath} from '../core/paths';
import {ExportHistory, formatBytes} from '../core/ExportHistory';
import type {ExportHistoryItem} from '../core/ExportHistory';
import {TEMPLATES} from '../core/Templates';
import {FileIO, Picker} from '../native/PhotoCraftEngine';
import {
  Badge,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  FadeInView,
  GhostButton,
  IconButton,
  PrimaryButton,
  SectionLabel,
  SearchBar,
  Sheet,
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

/** SAF mime coverage for every format the engine can really open. */
const IMPORT_MIMES = [
  'image/*',
  'image/vnd.adobe.photoshop',
  'application/x-photoshop',
  'application/photoshop',
  'application/psd',
  'application/octet-stream',
];

/** Pull a usable file name out of a picked content:// uri. */
function nameFromUri(uri: string): string {
  try {
    const tail = decodeURIComponent(uri.split('/').pop() ?? 'import');
    const clean = tail.replace(/[^\w.\u0600-\u06FF-]/g, '_');
    return /\.[a-z0-9]{2,5}$/i.test(clean) ? clean : `${clean || 'import'}.psd`;
  } catch {
    return 'import.psd';
  }
}

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
  const [loading, setLoading] = useState(true);
  const [exports_, setExports] = useState<ExportHistoryItem[]>([]);
  const [manage, setManage] = useState<ProjectMeta | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<ProjectMeta | null>(null);
  const [importing, setImporting] = useState(false);

  const reload = useCallback(async () => {
    setProjects(await ProjectsStore.search(query));
    setContinue(await ProjectsStore.continueCandidate());
    setExports(await ExportHistory.list());
  }, [query]);

  useEffect(() => {
    reload()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [reload]);

  const create = async () => {
    await Editor.newDocument(name || 'Untitled', size[0], size[1]);
    onNavigate('editor');
  };

  /** Real system-picker import: copy into app storage, then open via engine. */
  const importFile = async () => {
    if (!Picker || !FileIO) {
      showToast(s.home.importFailed, 'error');
      return;
    }
    setImporting(true);
    try {
      const uri = await Picker.pickDocument(IMPORT_MIMES);
      if (!uri) {
        return; // user cancelled — not an error
      }
      const path = await FileIO.copyUriToCache(uri, nameFromUri(uri));
      await openDocument(path);
      showToast(s.home.imported);
      onNavigate('editor');
    } catch {
      showToast(s.home.importFailed, 'error');
    } finally {
      setImporting(false);
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
      await openDocument(autosavePath());
      onNavigate('editor');
      showToast(s.home.recovered);
    } catch {
      showToast(s.home.openError, 'error');
    }
  };

  const doRename = async () => {
    if (!manage || !renameDraft.trim()) {
      return;
    }
    try {
      await ProjectsStore.rename(manage.path, renameDraft.trim());
      await reload();
      showToast(s.home.projectRenamed);
    } catch {
      showToast(s.home.openError, 'error');
    } finally {
      setManage(null);
    }
  };

  const doDuplicate = async () => {
    if (!manage) {
      return;
    }
    try {
      await ProjectsStore.duplicate(manage.path);
      await reload();
      showToast(s.home.projectDuplicated);
    } catch {
      showToast(s.home.openError, 'error');
    } finally {
      setManage(null);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) {
      return;
    }
    try {
      await ProjectsStore.deleteProject(confirmDelete.path);
      await reload();
      showToast(s.home.projectDeleted);
    } catch {
      showToast(s.home.openError, 'error');
    } finally {
      setConfirmDelete(null);
    }
  };

  const wide = width >= 720;
  const tileW = wide ? '31%' : '47%';

  return (
    <ScrollView
      style={[styles.root, {backgroundColor: c.bg}]}
      contentContainerStyle={[styles.content, {paddingTop: insets.top + 12}]}
      accessible={false}>
      {/* header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.logo, {color: c.text}]} accessible accessibilityRole="header">
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
            <ProjectThumb p={continue_} c={c} size={62} />
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
        <View style={{flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8}}>
          {importing ? <ActivityIndicator size="small" color={c.accent} accessibilityLabel={s.common.busy} /> : null}
          <GhostButton label={s.home.importFile} onPress={importFile} />
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
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={c.accent} />
            <Text style={{color: c.textFaint, fontSize: 12}}>{s.home.loadingProjects}</Text>
          </View>
        ) : null}
        {!loading && projects.length === 0 && <EmptyState glyph="🗂" title={s.home.emptyRecents} />}
        {projects.slice(0, 8).map(p => (
          <Card key={p.id} onPress={() => openProject(p)} style={styles.projectRow}>
            <ProjectThumb p={p} c={c} size={46} />
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
            <IconButton
              glyph="⋯"
              size={32}
              label={`${s.common.more} — ${p.name}`}
              onPress={() => {
                setManage(p);
                setRenameDraft(p.name);
              }}
            />
          </Card>
        ))}
      </View>

      {/* export history */}
      <View style={{gap: 10}}>
        <SectionLabel
          text={s.home.exportHistory}
          action={<GhostButton label={s.editor.export} onPress={() => onNavigate('export')} />}
        />
        {exports_.length === 0 ? (
          <Text style={{color: c.textFaint, fontSize: 12.5}}>{s.home.emptyExports}</Text>
        ) : (
          exports_.slice(0, 3).map(h => (
            <View key={h.id} style={[styles.exportRow, {backgroundColor: c.surface, borderColor: c.border}]}>
              <Text style={{color: c.accent2, fontWeight: '800', fontSize: 11, textTransform: 'uppercase'}}>{h.format}</Text>
              <Text style={{color: c.text, fontSize: 12.5, fontWeight: '600', flex: 1}} numberOfLines={1}>
                {h.docName}
              </Text>
              <Text style={{color: c.textFaint, fontSize: 11}}>
                {formatBytes(h.bytes)} · {new Date(h.at).toLocaleDateString()}
              </Text>
            </View>
          ))
        )}
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

      {/* project management sheet */}
      <Sheet visible={manage != null} onClose={() => setManage(null)} title={manage?.name ?? ''} heightPct={0.42}>
        <View style={{gap: 14}}>
          <SectionLabel text={s.home.renameProject} />
          <TextInputRow value={renameDraft} onChange={setRenameDraft} placeholder={manage?.name ?? ''} />
          <View style={{flexDirection: 'row', gap: 10, flexWrap: 'wrap'}}>
            <Chip label={s.common.rename} active onPress={doRename} />
            <Chip label={s.common.duplicate} onPress={doDuplicate} />
            <Chip
              label={s.common.delete}
              onPress={() => {
                if (manage) {
                  setConfirmDelete(manage);
                  setManage(null);
                }
              }}
            />
          </View>
          {manage?.thumbPath ? (
            <View style={{alignItems: 'center', paddingVertical: 8}}>
              <Image
                source={{uri: `file://${manage.thumbPath}`}}
                style={{width: 180, height: 180, borderRadius: 12, backgroundColor: c.checker}}
                resizeMode="contain"
                accessible
                accessibilityLabel={manage.name}
              />
            </View>
          ) : null}
        </View>
      </Sheet>

      {/* delete confirmation */}
      <ConfirmDialog
        visible={confirmDelete != null}
        title={confirmDelete?.name ?? ''}
        message={s.home.deleteProjectConfirm}
        confirmLabel={s.common.delete}
        cancelLabel={s.common.cancel}
        danger
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </ScrollView>
  );
}

/** Real engine-rendered thumbnail (PNG beside the project file), with a
 *  graceful placeholder glyph when the project has none yet. */
function ProjectThumb({p, c, size}: {p: ProjectMeta; c: ReturnType<typeof useTheme>; size: number}) {
  const [ok, setOk] = useState(true);
  if (p.thumbPath && ok) {
    return (
      <Image
        source={{uri: `file://${p.thumbPath}`}}
        style={{width: size, height: size, borderRadius: 10, backgroundColor: c.checker}}
        onError={() => setOk(false)}
        accessible
        accessibilityLabel={p.name}
      />
    );
  }
  return (
    <View style={[styles.projectThumb, {backgroundColor: c.surface3, width: size, height: size, borderRadius: 10}]}>
      <Text style={{color: c.textFaint, fontSize: size * 0.36}}>🖼</Text>
    </View>
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
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  projectRow: {flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10},
  projectThumb: {alignItems: 'center', justifyContent: 'center', overflow: 'hidden'},
  loadingRow: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8},
  exportRow: {borderRadius: 10, borderWidth: 1, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8},
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
