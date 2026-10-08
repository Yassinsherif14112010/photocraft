/**
 * Editor — the studio: native SurfaceView canvas + bottom tool tabs
 * (Layers / Text / Styles / AI) + top actions (undo, export, smart resize).
 */
import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import {theme} from '../theme';
import {dir, t} from '../i18n';
import {Editor as Store, runCommand, useEditor} from '../core/DocumentStore';
import {History} from '../core/HistoryManager';
import {TextStudio} from '../core/engines/TextStudio';
import {LayerStyles, STYLE_PRESETS} from '../core/engines/LayerStyles';
import type {EffectSpec} from '../core/engines/LayerStyles';
import {OcrEngine} from '../core/engines/OcrEngine';
import {BackgroundRemoval} from '../core/engines/BackgroundRemoval';
import {BLEND_MODES, EFFECT_KINDS} from '../core/types';
import {LayersPanel} from '../components/LayersPanel';
import {ColorPicker} from '../components/ColorPicker';
import type {Route} from '../App';

type Tab = 'layers' | 'text' | 'styles' | 'ai';

export function EditorScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const s = t();
  const st = useEditor();
  const [tab, setTab] = useState<Tab>('layers');
  const [panel, setPanel] = useState<'none' | 'ocr' | 'bg'>('none');
  const [textDraft, setTextDraft] = useState('');
  const [textColor, setTextColor] = useState('#101014');
  const [fontSize, setFontSize] = useState(48);
  const [stylePreview, setStylePreview] = useState<EffectSpec[]>(STYLE_PRESETS[0].effects);

  useEffect(() => {
    // Session arrived without a doc (cold start)? Nothing to do; Home creates docs.
  }, []);

  if (!st.sessionId) {
    return (
      <View style={styles.center}>
        <Text style={styles.dim}>{s.common.error}</Text>
        <Pressable style={styles.ghost} onPress={() => onNavigate('home')}>
          <Text style={styles.ghostText}>← {s.home.newDoc}</Text>
        </Pressable>
      </View>
    );
  }

  const active = st.layers.find(l => l.id === st.activeLayerId);

  const addText = async () => {
    if (!textDraft.trim()) {
      return;
    }
    const id = await TextStudio.add({
      text: textDraft,
      x: 64,
      y: 96,
      sizePt: fontSize,
      color: textColor,
    });
    History.push('text.add');
    if (id > 0) {
      await Store.setActiveLayer(id);
    }
    setTextDraft('');
  };

  const applyPreset = async (effects: EffectSpec[]) => {
    if (!active) {
      return;
    }
    await LayerStyles.apply(active.id, effects);
    History.push('style.apply');
    setStylePreview(effects);
  };

  const runOcr = async () => setPanel('ocr');
  const runBg = async () => setPanel('bg');

  return (
    <View style={styles.root}>
      {/* canvas area: the native SurfaceView fills this via the host activity layout.
          On the JS side we show the composited preview through renderThumbnail. */}
      <View style={styles.canvasWrap}>
        <CanvasPlaceholder sessionId={st.sessionId} />
      </View>

      {/* top bar */}
      <View style={styles.topbar}>
        <Pressable onPress={() => History.undo()} style={styles.iconBtn}>
          <Text style={styles.iconText}>↩︎</Text>
        </Pressable>
        <Pressable onPress={() => History.redo()} style={styles.iconBtn}>
          <Text style={styles.iconText}>↪︎</Text>
        </Pressable>
        <View style={{flex: 1}} />
        <Pressable style={styles.iconBtn} onPress={() => onNavigate('smart')}>
          <Text style={styles.iconText}>📐</Text>
        </Pressable>
        <Pressable style={styles.primarySm} onPress={() => onNavigate('export')}>
          <Text style={styles.primarySmText}>{s.editor.export}</Text>
        </Pressable>
      </View>

      {/* tool tabs */}
      <View style={styles.tabs}>
        {(['layers', 'text', 'styles', 'ai'] as Tab[]).map(k => (
          <Pressable key={k} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k)}>
            <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>
              {k === 'layers' ? s.editor.layers : k === 'text' ? s.editor.text : k === 'styles' ? s.editor.styles : 'AI'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* panel body */}
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        {tab === 'layers' && <LayersPanel />}

        {tab === 'text' && (
          <View style={styles.gap}>
            <Text style={styles.label}>{s.text.placeholder}</Text>
            <TextInputBox value={textDraft} onChange={setTextDraft} />
            <Text style={styles.label}>{s.editor.opacity} · {s.text.color}</Text>
            <ColorPicker value={textColor} onChange={setTextColor} />
            <Text style={styles.label}>{s.text.size}: {Math.round(fontSize)}pt</Text>
            <Slider
              minimumValue={10}
              maximumValue={220}
              step={1}
              value={fontSize}
              onSlidingStart={() => History.beginCoalesce('size')}
              onValueChange={setFontSize}
              onSlidingComplete={() => History.endCoalesce()}
              minimumTrackTintColor={theme.accent}
            />
            <Pressable style={styles.primary} onPress={addText}>
              <Text style={styles.primaryText}>+ {s.editor.text}</Text>
            </Pressable>
          </View>
        )}

        {tab === 'styles' && (
          <View style={styles.gap}>
            {STYLE_PRESETS.map(p => (
              <Pressable key={p.name} style={styles.styleCard} onPress={() => applyPreset(p.effects)}>
                <Text style={styles.styleName}>{p.name}</Text>
                <Text style={styles.styleMeta}>
                  {p.effects.map(e => s.styles10[e.kind]).join(' · ')}
                </Text>
              </Pressable>
            ))}
            {active && (
              <Text style={styles.label}>
                {s.editor.styles}: {active.name} — {EFFECT_KINDS.length} {s.editor.styles}
              </Text>
            )}
          </View>
        )}

        {tab === 'ai' && (
          <View style={styles.gap}>
            <Pressable style={styles.aiCard} onPress={runOcr}>
              <Text style={styles.aiTitle}>🔍 {s.ocrScreen.title}</Text>
              <Text style={styles.aiMeta}>{s.ocrScreen.run} · AR/EN · on-device</Text>
            </Pressable>
            <Pressable style={styles.aiCard} onPress={runBg}>
              <Text style={styles.aiTitle}>✂️ {s.bg.title}</Text>
              <Text style={styles.aiMeta}>BiRefNet Lite · on-device</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* blend + opacity quick strip for the active layer */}
      {active && (
        <View style={styles.quickStrip}>
          <Text style={styles.label}>{active.name}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {BLEND_MODES.map(b => (
              <Pressable
                key={b}
                style={[styles.chip, active.blend === b && styles.chipOn]}
                onPress={() => runCommand('layer.setProps', {layer: active.id, blend: b})}>
                <Text style={[styles.chipText, active.blend === b && styles.chipTextOn]}>{b}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Slider
            minimumValue={0}
            maximumValue={100}
            value={active.opacity * 100}
            onSlidingComplete={v =>
              runCommand('layer.setProps', {layer: active.id, opacity: v / 100})
            }
            minimumTrackTintColor={theme.accent}
          />
        </View>
      )}

      {/* AI modals */}
      <Modal visible={panel === 'ocr'} animationType="slide" onRequestClose={() => setPanel('none')}>
        <OcrPanel onClose={() => setPanel('none')} />
      </Modal>
      <Modal visible={panel === 'bg'} animationType="slide" onRequestClose={() => setPanel('none')}>
        <BgPanel onClose={() => setPanel('none')} />
      </Modal>

      {st.busy && (
        <View style={styles.busy}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.busyText}>{s.common.busy}</Text>
        </View>
      )}
    </View>
  );
}

function TextInputBox({value, onChange}: {value: string; onChange: (v: string) => void}) {
  const s = t();
  return (
    <TextInput
      style={[styles.input, {writingDirection: dir()}]}
      value={value}
      onChangeText={onChange}
      multiline
      placeholder={s.text.placeholder}
      placeholderTextColor={theme.textDim}
    />
  );
}

function CanvasPlaceholder({sessionId}: {sessionId: number}) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import('../../native/PhotoCraftEngine').then(async ({Engine}) => {
      try {
        const data = await Engine.renderThumbnail(sessionId, 1024);
        if (alive) {
          setThumb(data);
        }
      } catch {
        /* first frame before first command is expected to be empty */
      }
    });
    return () => {
      alive = false;
    };
  }, [sessionId]);
  if (!thumb) {
    return <View style={styles.canvas} />;
  }
  const {Image} = require('react-native');
  return <Image source={{uri: thumb}} style={styles.canvas} resizeMode="contain" />;
}

function OcrPanel({onClose}: {onClose: () => void}) {
  const s = t();
  const [hits, setHits] = useState<Array<{text: string; confidence: number}> | null>(null);
  const [ready, setReady] = useState(true);
  const [busyOcr, setBusyOcr] = useState(false);

  const run = async () => {
    setBusyOcr(true);
    try {
      const image = await loadInboxAsDataUrl();
      const results = await OcrEngine.detectAndRecognize(image);
      setHits(results);
    } catch {
      setReady(await OcrEngine.isReady());
    } finally {
      setBusyOcr(false);
    }
  };

  const create = async () => {
    if (!hits) {
      return;
    }
    await OcrEngine.createTextLayers(hits as any);
    onClose();
  };

  return (
    <View style={styles.modal}>
      <Text style={styles.h1}>{s.ocrScreen.title}</Text>
      {!ready && <Text style={styles.dim}>{s.ocrScreen.notReady}</Text>}
      <Pressable style={styles.primary} onPress={run}>
        <Text style={styles.primaryText}>{busyOcr ? s.common.busy : s.ocrScreen.run}</Text>
      </Pressable>
      <ScrollView style={{flex: 1}}>
        {(hits ?? []).map((h, i) => (
          <View key={i} style={styles.hitRow}>
            <Text style={styles.hitText} numberOfLines={1}>{h.text}</Text>
            <Text style={styles.hitConf}>{Math.round(h.confidence * 100)}%</Text>
          </View>
        ))}
      </ScrollView>
      <Pressable style={styles.primary} onPress={create}>
        <Text style={styles.primaryText}>{s.ocrScreen.create}</Text>
      </Pressable>
      <Pressable onPress={onClose}><Text style={styles.ghostText}>{s.common.cancel}</Text></Pressable>
    </View>
  );
}

function BgPanel({onClose}: {onClose: () => void}) {
  const s = t();
  const [ready, setReady] = useState(true);
  const [busyBg, setBusyBg] = useState(false);
  const st = useEditor();

  const go = async (mode: 'quick' | 'hq') => {
    if (!st.activeLayerId) {
      return;
    }
    setBusyBg(true);
    try {
      const image = await loadInboxAsDataUrl();
      if (mode === 'hq') {
        await BackgroundRemoval.removeHQ(st.activeLayerId, image);
      } else {
        await BackgroundRemoval.removeQuick(st.activeLayerId, image);
      }
      onClose();
    } catch {
      setReady(await BackgroundRemoval.isReady());
    } finally {
      setBusyBg(false);
    }
  };

  return (
    <View style={styles.modal}>
      <Text style={styles.h1}>{s.bg.title}</Text>
      {!ready && <Text style={styles.dim}>{s.bg.notReady}</Text>}
      <Pressable style={styles.primary} onPress={() => go('quick')} disabled={busyBg}>
        <Text style={styles.primaryText}>{busyBg ? s.common.busy : s.bg.quick}</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => go('hq')} disabled={busyBg}>
        <Text style={styles.secondaryText}>{s.bg.hq}</Text>
      </Pressable>
      <Pressable onPress={onClose}><Text style={styles.ghostText}>{s.common.cancel}</Text></Pressable>
    </View>
  );
}

async function loadInboxAsDataUrl(): Promise<string> {
  // The inbox file is staged by the share-intent receiver (MainActivity).
  const path = '/data/data/com.photocraft.mobile/files/inbox/last.png';
  const {Engine} = await import('../../native/PhotoCraftEngine');
  // Real base64 read through the engine module (app-storage paths only).
  const b64 = await (Engine as any).readFileBase64(path);
  return `data:image/png;base64,${b64}`;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: theme.bg},
  canvasWrap: {flex: 1, padding: 8},
  canvas: {flex: 1, backgroundColor: theme.surface, borderRadius: theme.radius},
  topbar: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8},
  iconBtn: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: theme.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  iconText: {color: theme.text, fontSize: 18},
  primarySm: {backgroundColor: theme.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10},
  primarySmText: {color: '#fff', fontWeight: '700'},
  tabs: {flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 6},
  tab: {flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.surface2, alignItems: 'center'},
  tabOn: {backgroundColor: theme.accent},
  tabText: {color: theme.textDim, fontWeight: '600'},
  tabTextOn: {color: '#fff'},
  panel: {maxHeight: 260},
  panelContent: {padding: 12, gap: 8},
  gap: {gap: 10},
  label: {color: theme.textDim, fontSize: 12, fontWeight: '600'},
  input: {
    backgroundColor: theme.surface2, color: theme.text, borderRadius: 10,
    padding: 12, minHeight: 84, textAlignVertical: 'top',
  },
  primary: {backgroundColor: theme.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 12},
  primaryText: {color: '#fff', fontWeight: '800'},
  secondary: {backgroundColor: theme.surface2, borderRadius: 12, alignItems: 'center', paddingVertical: 12},
  secondaryText: {color: theme.text, fontWeight: '700'},
  ghost: {padding: 8},
  ghostText: {color: theme.accent2, fontWeight: '600'},
  dim: {color: theme.textDim},
  styleCard: {backgroundColor: theme.surface, borderRadius: theme.radius, padding: 14, borderWidth: 1, borderColor: theme.border},
  styleName: {color: theme.text, fontWeight: '700'},
  styleMeta: {color: theme.textDim, fontSize: 12, marginTop: 4},
  aiCard: {backgroundColor: theme.surface, borderRadius: theme.radius, padding: 16, borderWidth: 1, borderColor: theme.border},
  aiTitle: {color: theme.text, fontWeight: '800', fontSize: 16},
  aiMeta: {color: theme.textDim, marginTop: 4, fontSize: 12},
  quickStrip: {padding: 10, gap: 6, borderTopWidth: 1, borderTopColor: theme.border},
  chip: {paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.surface2, marginRight: 6},
  chipOn: {backgroundColor: theme.accent},
  chipText: {color: theme.textDim, fontSize: 12},
  chipTextOn: {color: '#fff', fontWeight: '700'},
  busy: {
    position: 'absolute', bottom: 16, left: 16, right: 16,
    backgroundColor: theme.surface, borderRadius: 12, padding: 12,
    flexDirection: 'row', gap: 10, alignItems: 'center',
  },
  busyText: {color: theme.text},
  modal: {flex: 1, backgroundColor: theme.bg, padding: 20, gap: 12},
  h1: {color: theme.text, fontSize: 22, fontWeight: '800'},
  hitRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: theme.surface, borderRadius: 10, padding: 12, marginBottom: 8,
  },
  hitText: {color: theme.text, flex: 1, marginRight: 10},
  hitConf: {color: theme.success, fontWeight: '700'},
});
