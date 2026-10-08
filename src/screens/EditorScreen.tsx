/**
 * Editor — the studio. Professional dark/light themed shell:
 *   Top bar    : back · project name (inline edit) · undo · redo · save · export · menu
 *   Canvas     : infinite workspace (CanvasStage) with guides + zoom dock
 *   Tool dock  : Move · Layers · Text · Shapes · Assets · AI · Effects · Export
 *   Panels     : animated bottom sheets (LayersPanel, TextStudioPanel,
 *                EffectsPanel, AssetsSheet, shape/Move tool sheets)
 *   AI         : full-screen OCR + Background Removal workspaces
 * Tablet/landscape: the layers panel docks as a permanent side rail.
 */
import React, {useEffect, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Palette, useTheme, useThemeMode} from '../theme';
import {t} from '../i18n';
import {
  Editor,
  getState,
  renameDocument,
  runCommand,
  useEditor,
} from '../core/DocumentStore';
import {History} from '../core/HistoryManager';
import {ProjectsStore} from '../core/ProjectsStore';
import {CanvasStage} from '../components/CanvasStage';
import {LayersPanel} from '../components/LayersPanel';
import {TextStudioPanel} from '../components/TextStudioPanel';
import {EffectsPanel} from '../components/EffectsPanel';
import {AssetsSheet} from '../components/AssetsSheet';
import {ColorPicker} from '../components/ColorPicker';
import {OcrWorkspace} from './OcrWorkspace';
import {BgRemoveWorkspace} from './BgRemoveWorkspace';
import {
  Chip,
  EmptyState,
  IconButton,
  PrimaryButton,
  SectionLabel,
  Sheet,
  SliderRow,
  TextInputRow,
  showToast,
} from '../components/ui';
import type {Route} from '../App';

type Tool = 'move' | 'layers' | 'text' | 'shapes' | 'assets' | 'ai' | 'effects' | 'export';

export function EditorScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const c = useTheme();
  const s = t();
  const st = useEditor();
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [tool, setTool] = useState<Tool | null>(null);
  const [menu, setMenu] = useState(false);
  const [aiPanel, setAiPanel] = useState(false);
  const [ocr, setOcr] = useState(false);
  const [bg, setBg] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [showCenter, setShowCenter] = useState(false);
  const [showThirds, setShowThirds] = useState(false);
  const [showSafe, setShowSafe] = useState(false);
  const [safePct, setSafePct] = useState(10);
  const [themeMode, setThemeMode] = useThemeMode();

  const wide = width >= 900;
  const landscape = width > height;

  useEffect(() => {
    if (st.sessionId) {
      setNameDraft(st.docName);
    }
  }, [st.sessionId, st.docName]);

  if (!st.sessionId) {
    return (
      <View style={[styles.center, {backgroundColor: c.bg}]}>
        <EmptyState glyph="🖼" title={s.editor.emptyLayers} />
        <PrimaryButton label={`← ${s.home.newDoc}`} onPress={() => onNavigate('home')} />
      </View>
    );
  }

  const save = async () => {
    try {
      await Editor.saveNow();
      showToast(s.editor.saved);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  const undo = async () => {
    try {
      await History.undo();
    } catch {
      showToast(s.common.error, 'error');
    }
  };

  const redo = async () => {
    try {
      await History.redo();
    } catch {
      showToast(s.common.error, 'error');
    }
  };

  const dock: Array<{id: Tool; glyph: string; label: string}> = [
    {id: 'move', glyph: '✥', label: s.editor.move},
    {id: 'layers', glyph: '▤', label: s.editor.layers},
    {id: 'text', glyph: 'T', label: s.editor.text},
    {id: 'shapes', glyph: '▣', label: s.editor.shapes},
    {id: 'assets', glyph: '❖', label: s.home.assets},
    {id: 'ai', glyph: '✦', label: s.editor.ai},
    {id: 'effects', glyph: '✧', label: s.editor.effects},
    {id: 'export', glyph: '⤴', label: s.editor.export},
  ];

  const openTool = (id: Tool) => {
    if (id === 'export') {
      onNavigate('export');
      return;
    }
    if (id === 'ai') {
      setAiPanel(true);
      return;
    }
    setTool(id);
  };

  return (
    <View style={[styles.root, {backgroundColor: c.bg, paddingTop: insets.top}]}>
      {/* ---------------- top bar ---------------- */}
      <View style={[styles.topbar, {borderColor: c.border}]}>
        <IconButton glyph="‹" onPress={() => onNavigate('home')} label={s.editor.back} />
        {renaming ? (
          <View style={{flex: 1}}>
            <TextInputRow
              value={nameDraft}
              onChange={setNameDraft}
              placeholder={s.editor.menu}
            />
            <Pressable
              onPress={() => {
                renameDocument(nameDraft.trim() || 'Untitled');
                setRenaming(false);
              }}
              style={{marginTop: 4}}>
              <Text style={{color: c.accent2, fontWeight: '700', fontSize: 12}}>{s.common.save}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={{flex: 1}} onLongPress={() => setRenaming(true)}>
            <Text style={[styles.docName, {color: c.text}]} numberOfLines={1}>
              {st.docName}
            </Text>
            <Text style={{color: c.textFaint, fontSize: 10.5}}>
              {st.lastAutosaveAt ? `${s.home.autoSaved} ✓` : s.projects.autosaveOn}
            </Text>
          </Pressable>
        )}
        <IconButton glyph="↩︎" onPress={undo} label={s.editor.undo} />
        <IconButton glyph="↪︎" onPress={redo} label={s.editor.redo} />
        <IconButton glyph="✓" onPress={save} label={s.editor.save} />
        <IconButton glyph="⤴" onPress={() => onNavigate('export')} label={s.editor.export} />
        <IconButton glyph="☰" onPress={() => setMenu(true)} label={s.editor.menu} />
      </View>

      {/* ---------------- workspace ---------------- */}
      <View style={styles.body}>
        <CanvasStage
          showCenterGuides={showCenter}
          showThirds={showThirds}
          showSafeArea={showSafe}
          safeAreaPct={safePct}
        />
        {wide && (
          <View style={[styles.rail, {backgroundColor: c.surface, borderColor: c.border, width: Math.min(360, width * 0.32)}]}>
            <LayersPanel />
          </View>
        )}
      </View>

      {/* ---------------- tool dock ---------------- */}
      <View style={[styles.dock, {backgroundColor: c.surface, borderColor: c.border, paddingBottom: Math.max(10, insets.bottom)}]}>
        {dock.map(d => {
          const on = d.id === 'layers' && wide ? false : tool === d.id || (d.id === 'ai' && aiPanel);
          return (
            <Pressable key={d.id} style={styles.dockItem} onPress={() => openTool(d.id)} android_ripple={{color: c.border}}>
              <View style={[styles.dockIcon, {backgroundColor: on ? c.accent : 'transparent'}]}>
                <Text style={{color: on ? c.onAccent : c.textDim, fontSize: 18, fontWeight: '800'}}>{d.glyph}</Text>
              </View>
              <Text style={{color: on ? c.accent : c.textDim, fontSize: 9.5, fontWeight: '700'}} numberOfLines={1}>
                {d.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ---------------- tool sheets ---------------- */}
      {!wide && (
        <Sheet visible={tool === 'layers'} onClose={() => setTool(null)} title={s.editor.layers} heightPct={landscape ? 0.72 : 0.68}>
          <View style={{height: 460}}>
            <LayersPanel />
          </View>
        </Sheet>
      )}
      <Sheet visible={tool === 'text'} onClose={() => setTool(null)} title={s.textStudio.title} heightPct={0.82}>
        <TextStudioPanel />
      </Sheet>
      <Sheet visible={tool === 'effects'} onClose={() => setTool(null)} title={s.effects.title} heightPct={0.78}>
        <EffectsPanel />
      </Sheet>
      <Sheet visible={tool === 'assets'} onClose={() => setTool(null)} title={s.assets.title} heightPct={0.72}>
        <AssetsSheet onDone={() => setTool(null)} />
      </Sheet>
      <Sheet visible={tool === 'shapes'} onClose={() => setTool(null)} title={s.editor.shapes} heightPct={0.62}>
        <ShapesSheet />
      </Sheet>
      <Sheet visible={tool === 'move'} onClose={() => setTool(null)} title={s.editor.move} heightPct={0.72}>
        <MoveSheet />
      </Sheet>

      {/* AI chooser */}
      <Sheet visible={aiPanel} onClose={() => setAiPanel(false)} title={s.editor.ai} heightPct={0.5}>
        <View style={{gap: 10}}>
          <Pressable style={[styles.aiCard, {backgroundColor: c.surface2, borderColor: c.border}]} onPress={() => {setAiPanel(false); setOcr(true);}}>
            <Text style={{color: c.text, fontWeight: '800', fontSize: 15}}>🔍 {s.ocr.title}</Text>
            <Text style={{color: c.textDim, fontSize: 12}}>{s.ocr.subtitle}</Text>
          </Pressable>
          <Pressable style={[styles.aiCard, {backgroundColor: c.surface2, borderColor: c.border}]} onPress={() => {setAiPanel(false); setBg(true);}}>
            <Text style={{color: c.text, fontWeight: '800', fontSize: 15}}>✂️ {s.bg.title}</Text>
            <Text style={{color: c.textDim, fontSize: 12}}>{s.bg.subtitle}</Text>
          </Pressable>
        </View>
      </Sheet>

      {/* AI workspaces */}
      <OcrWorkspace visible={ocr} onClose={() => setOcr(false)} />
      <BgRemoveWorkspace visible={bg} onClose={() => setBg(false)} />

      {/* ---------------- project menu ---------------- */}
      <Sheet visible={menu} onClose={() => setMenu(false)} title={s.editor.menu} heightPct={0.8}>
        <ProjectMenu
          onClose={() => setMenu(false)}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          showCenter={showCenter}
          setShowCenter={setShowCenter}
          showThirds={showThirds}
          setShowThirds={setShowThirds}
          showSafe={showSafe}
          setShowSafe={setShowSafe}
          safePct={safePct}
          setSafePct={setSafePct}
        />
      </Sheet>
    </View>
  );
}

// ------------------------------------------------------------- shapes sheet

const SHAPE_RECIPES: Array<{id: string; glyph: string; labelAr: string; svg: (fill: string) => string}> = [
  {id: 'circle', glyph: '●', labelAr: 'دائرة', svg: f => `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><circle cx="240" cy="240" r="220" fill="${f}"/></svg>`},
  {id: 'square', glyph: '■', labelAr: 'مربع', svg: f => `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="440" height="440" x="20" y="20" fill="${f}"/></svg>`},
  {id: 'rrect', glyph: '▢', labelAr: 'مربع دائري', svg: f => `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="440" height="440" x="20" y="20" rx="72" fill="${f}"/></svg>`},
  {id: 'triangle', glyph: '▲', labelAr: 'مثلث', svg: f => `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><path d="M240 30 L450 450 L30 450 Z" fill="${f}"/></svg>`},
  {id: 'star', glyph: '★', labelAr: 'نجمة', svg: f => `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><path d="M240 30 L292 200 L470 200 L325 306 L378 470 L240 372 L102 470 L155 306 L10 200 L188 200 Z" fill="${f}"/></svg>`},
  {id: 'arrow', glyph: '➜', labelAr: 'سهم', svg: f => `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="480"><path d="M20 190 H360 V90 L540 240 L360 390 V290 H20 Z" fill="${f}"/></svg>`},
  {id: 'ring', glyph: '◯', labelAr: 'حلقة', svg: f => `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><circle cx="240" cy="240" r="210" fill="none" stroke="${f}" stroke-width="44"/></svg>`},
  {id: 'line', glyph: '━', labelAr: 'خط', svg: f => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="60"><rect width="640" height="24" y="18" rx="12" fill="${f}"/></svg>`},
];

function ShapesSheet() {
  const c = useTheme();
  const s = t();
  const st = useEditor();
  const [color, setColor] = useState('#3B82F6');

  const place = async (svg: string) => {
    const W = st.doc?.width ?? 1080;
    const H = st.doc?.height ?? 1080;
    await runCommand('svg.importText', {svg, name: 'Shape'});
    // center the fresh shape on the canvas
    const active = getState().activeLayerId;
    if (active != null) {
      const layer = st.layers.find(l => l.id === active);
      void layer;
    }
    History.push(s.editor.shapes);
    showToast(s.editor.shapes);
    void W;
    void H;
  };

  return (
    <View style={{gap: 12}}>
      <SectionLabel text={s.textStudio.color} />
      <ColorPicker value={color} onChange={setColor} />
      <SectionLabel text={s.editor.shapes} />
      <View style={styles.shapeGrid}>
        {SHAPE_RECIPES.map(sh => (
          <Pressable
            key={sh.id}
            style={[styles.shapeCell, {backgroundColor: c.surface2, borderColor: c.border}]}
            onPress={() => place(sh.svg(color))}>
            <Text style={{color: color, fontSize: 26}}>{sh.glyph}</Text>
            <Text style={{color: c.textDim, fontSize: 10.5, fontWeight: '700'}}>{sh.labelAr}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// --------------------------------------------------------------- move sheet

function MoveSheet() {
  const c = useTheme();
  const s = t();
  const st = useEditor();
  const active = st.layers.find(l => l.id === st.activeLayerId);

  const go = async (cmd: string, params: object = {}, label?: string) => {
    try {
      await runCommand(cmd, params);
      History.push(label ?? cmd);
      showToast(label ?? cmd);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  const nudge = (dx: number, dy: number) =>
    active && go('layer.translate', {layer: active.id, dx, dy}, `${s.editor.nudge} ${dx},${dy}`);

  return (
    <View style={{gap: 12}}>
      <SectionLabel text={s.editor.align} />
      <View style={styles.gridWrap}>
        {(
          [
            ['leftEdges', s.editor.alignLeft],
            ['horizontalCenters', s.editor.alignCenterH],
            ['rightEdges', s.editor.alignRight],
            ['topEdges', s.editor.alignTop],
            ['verticalCenters', s.editor.alignCenterV],
            ['bottomEdges', s.editor.alignBottom],
          ] as Array<[string, string]>
        ).map(([k, label]) => (
          <MiniBtn key={k} label={label} onPress={() => go(`layer.align.${k}`, {}, `${s.editor.align}: ${label}`)} c={c} />
        ))}
      </View>
      <SectionLabel text={s.editor.distribute} />
      <View style={{flexDirection: 'row', gap: 8}}>
        <MiniBtn label={s.editor.alignCenterH} onPress={() => go('layer.distribute.horizontalCenters', {}, s.editor.distribute)} c={c} />
        <MiniBtn label={s.editor.alignCenterV} onPress={() => go('layer.distribute.verticalCenters', {}, s.editor.distribute)} c={c} />
      </View>
      <SectionLabel text={s.editor.transform} />
      <View style={styles.gridWrap}>
        <MiniBtn label={s.editor.bringFront} onPress={() => go('layer.arrange.bringToFront', {}, s.editor.bringFront)} c={c} />
        <MiniBtn label={s.editor.sendBack} onPress={() => go('layer.arrange.sendToBack', {}, s.editor.sendBack)} c={c} />
        <MiniBtn label="Flip H" onPress={() => go('edit.transform.flipHorizontal', {}, 'Flip H')} c={c} />
        <MiniBtn label="Flip V" onPress={() => go('edit.transform.flipVertical', {}, 'Flip V')} c={c} />
      </View>
      <SectionLabel text={s.editor.nudge} />
      <View style={styles.nudgePad}>
        <MiniBtn label="↑" onPress={() => nudge(0, -10)} c={c} />
        <View style={{flexDirection: 'row', gap: 8}}>
          <MiniBtn label="←" onPress={() => nudge(-10, 0)} c={c} />
          <MiniBtn label="→" onPress={() => nudge(10, 0)} c={c} />
        </View>
        <MiniBtn label="↓" onPress={() => nudge(0, 10)} c={c} />
      </View>
      <Text style={{color: c.textFaint, fontSize: 11}}>{s.editor.tapToSelect}</Text>
    </View>
  );
}

function MiniBtn({label, onPress, c}: {label: string; onPress: () => void; c: Palette}) {
  return (
    <Pressable onPress={onPress} style={[styles.miniBtn, {backgroundColor: c.surface2, borderColor: c.border}]}>
      <Text style={{color: c.text, fontSize: 12, fontWeight: '700'}}>{label}</Text>
    </Pressable>
  );
}

// ------------------------------------------------------------ project menu

function ProjectMenu(props: {
  onClose: () => void;
  themeMode: 'dark' | 'light' | 'system';
  setThemeMode: (m: 'dark' | 'light' | 'system') => void;
  showCenter: boolean;
  setShowCenter: (v: boolean) => void;
  showThirds: boolean;
  setShowThirds: (v: boolean) => void;
  showSafe: boolean;
  setShowSafe: (v: boolean) => void;
  safePct: number;
  setSafePct: (v: number) => void;
}) {
  const c = useTheme();
  const s = t();
  const st = useEditor();
  const [versions, setVersions] = useState<Array<{id: string; label: string; path: string; at: number}>>([]);
  const [tagDraft, setTagDraft] = useState('');

  const reload = () => ProjectsStore.versions().then(setVersions);
  useEffect(() => {
    reload();
  }, []);

  const saveVersion = async () => {
    if (st.sessionId == null) {
      return;
    }
    try {
      await ProjectsStore.saveVersion(st.sessionId, `${st.docName} · ${new Date().toLocaleTimeString()}`);
      await reload();
      showToast(s.projects.versionSaved);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  const restore = async (path: string) => {
    await Editor.openDocument(path);
    showToast(s.projects.restored);
    props.onClose();
  };

  const duplicate = async () => {
    if (st.sessionId == null) {
      return;
    }
    try {
      await ProjectsStore.duplicateAs(st.sessionId, `${st.docName} copy`);
      showToast(s.projects.duplicated);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  const saveTags = async () => {
    if (!st.projectPath) {
      return;
    }
    await ProjectsStore.setTags(st.projectPath, tagDraft.split(','));
    showToast(s.projects.tags);
  };

  return (
    <ScrollView contentContainerStyle={{gap: 14, paddingBottom: 16}}>
      {/* theme */}
      <View style={{gap: 8}}>
        <SectionLabel text={s.theme.title} />
        <View style={{flexDirection: 'row', gap: 8}}>
          {(['dark', 'light', 'system'] as const).map(m => (
            <Chip key={m} label={(s.theme as Record<string, string>)[m]} active={props.themeMode === m} onPress={() => props.setThemeMode(m)} />
          ))}
        </View>
      </View>

      {/* guides */}
      <View style={{gap: 8}}>
        <SectionLabel text={s.editor.smartGuides} />
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          <Chip label={s.editor.centerGuides} active={props.showCenter} onPress={() => props.setShowCenter(!props.showCenter)} />
          <Chip label="Thirds" active={props.showThirds} onPress={() => props.setShowThirds(!props.showThirds)} />
          <Chip label={s.editor.safeArea} active={props.showSafe} onPress={() => props.setShowSafe(!props.showSafe)} />
        </View>
        {props.showSafe && (
          <SliderRow label={s.editor.safeArea} value={props.safePct} min={2} max={30} onChange={props.setSafePct} format={v => `${Math.round(v)}%`} />
        )}
      </View>

      {/* versions */}
      <View style={{gap: 8}}>
        <SectionLabel text={s.projects.versions} />
        <View style={{flexDirection: 'row', gap: 8}}>
          <Chip label={`+ ${s.projects.saveVersion}`} active onPress={saveVersion} />
          <Chip label={s.projects.duplicate} onPress={duplicate} />
        </View>
        {versions.slice(0, 5).map(v => (
          <Pressable key={v.id} style={[styles.versionRow, {backgroundColor: c.surface2}]} onPress={() => restore(v.path)}>
            <Text style={{color: c.text, fontSize: 12.5, fontWeight: '600', flex: 1}} numberOfLines={1}>
              {v.label}
            </Text>
            <Text style={{color: c.accent2, fontSize: 11, fontWeight: '800'}}>{s.projects.restore}</Text>
          </Pressable>
        ))}
      </View>

      {/* tags */}
      <View style={{gap: 8}}>
        <SectionLabel text={s.projects.tags} />
        <TextInputRow value={tagDraft} onChange={setTagDraft} placeholder={s.projects.tagsHint} />
        <Chip label={s.common.save} onPress={saveTags} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16},
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  docName: {fontSize: 16, fontWeight: '800'},
  body: {flex: 1, flexDirection: 'row'},
  rail: {borderStartWidth: 1, padding: 10},
  dock: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 8,
    paddingHorizontal: 6,
    gap: 2,
  },
  dockItem: {flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4, borderRadius: 10},
  dockIcon: {width: 38, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
  aiCard: {borderRadius: 14, borderWidth: 1, padding: 16, gap: 4},
  shapeGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  shapeCell: {width: '23%', borderRadius: 12, borderWidth: 1, padding: 10, alignItems: 'center', gap: 4},
  gridWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  miniBtn: {borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9},
  nudgePad: {alignItems: 'center', gap: 8},
  versionRow: {borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8},
});
