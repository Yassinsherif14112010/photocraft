/**
 * TextStudioPanel — the complete Text Studio experience:
 *   - live text editing bound to the active text layer (debounced real
 *     `type.edit`, canvas preview refreshes through the store)
 *   - font browser over the engine's real font book: search, recents,
 *     favorites, categories, preview cards, font pairs
 *   - typography / social / Arabic presets + multi-layer text templates
 *   - character & paragraph styles (engine style sheets)
 *   - full controls: size, weight, tracking, kerning, leading, baseline,
 *     alignment, caps, color, orientation, RTL, warp, stroke/shadow
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Palette, useTheme} from '../theme';
import {dir, t} from '../i18n';
import {Editor, getState, runCommand, useEditor} from '../core/DocumentStore';
import {History} from '../core/HistoryManager';
import {
  ARABIC_TEXT_PRESETS,
  FONT_PAIRS,
  SOCIAL_TEXT_PRESETS,
  TEXT_PRESETS,
  TEXT_TEMPLATES,
  TextStudio,
  detectRtl,
} from '../core/engines/TextStudio';
import type {FontFace, TextPreset} from '../core/engines/TextStudio';
import {LayerStyles} from '../core/engines/LayerStyles';
import type {EffectSpec} from '../core/engines/LayerStyles';
import {Chip, EmptyState, SectionLabel, Segmented, SliderRow, TextInputRow, showToast} from './ui';
import {ColorPicker} from './ColorPicker';

type BrowserTab = 'all' | 'recent' | 'favorites' | 'categories';

export function TextStudioPanel() {
  const c = useTheme();
  const s = t();
  const st = useEditor();
  const active = st.layers.find(l => l.id === st.activeLayerId);
  const isText = !!active && active.kind.toLowerCase().includes('text');

  // ---- live text -----------------------------------------------------------
  const [draft, setDraft] = useState('');
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const typingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isText || !active || loadedId === active.id) {
      return;
    }
    setLoadedId(active.id);
    TextStudio.info(active.id)
      .then((info: any) => {
        setDraft(typeof info?.text === 'string' ? info.text : '');
      })
      .catch(() => setDraft(''));
  }, [active, isText, loadedId]);

  const onDraftChange = useCallback(
    (v: string) => {
      setDraft(v);
      if (!active) {
        return;
      }
      if (typingRef.current) {
        clearTimeout(typingRef.current);
      }
      typingRef.current = setTimeout(async () => {
        try {
          await TextStudio.setText(active.id, v);
          History.push(s.textStudio.liveEditing, 'liveText');
        } catch {
          /* layer may have been removed mid-typing */
        }
      }, 420);
    },
    [active, s],
  );

  const addText = async () => {
    const text = draft.trim() || s.text.placeholder;
    const id = await TextStudio.add({
      text,
      x: Math.round((st.doc?.width ?? 1080) * 0.08),
      y: Math.round((st.doc?.height ?? 1080) * 0.1),
      sizePt: 64,
      color: '#101014',
    });
    History.push(s.textStudio.addText);
    if (id > 0) {
      await Editor.setActiveLayer(id);
    }
    showToast(s.textStudio.addText);
  };

  const applyToActive = async (fn: (id: number) => Promise<unknown>, label: string) => {
    if (!active) {
      return;
    }
    try {
      await fn(active.id);
      History.push(label);
      showToast(label);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  // ---- font browser --------------------------------------------------------
  const [fonts, setFonts] = useState<FontFace[]>([]);
  const [families, setFamilies] = useState<string[]>([]);
  const [fav, setFav] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [cats, setCats] = useState<Record<string, string[]>>({});
  const [tab, setTab] = useState<BrowserTab>('all');
  const [cat, setCat] = useState('all');
  const [fontQuery, setFontQuery] = useState('');
  const [activeFont, setActiveFont] = useState<string | null>(null);

  const reloadFonts = useCallback(async () => {
    try {
      const faces = await TextStudio.listFonts();
      setFonts(faces);
      setFamilies([...new Set(faces.map(f => f.family))]);
      setCats(await TextStudio.fontCategories());
      setFav(await TextStudio.fontFavorites());
      setRecents(await TextStudio.recentFonts());
    } catch {
      /* engine will expose fonts once a doc is open */
    }
  }, []);

  useEffect(() => {
    reloadFonts();
  }, [reloadFonts]);

  const shownFonts = useMemo(() => {
    let list = families;
    if (tab === 'recent') {
      list = recents;
    } else if (tab === 'favorites') {
      list = fav;
    } else if (tab === 'categories' && cat !== 'all') {
      list = cats[cat] ?? [];
    }
    if (fontQuery.trim()) {
      const q = fontQuery.toLowerCase();
      list = list.filter(f => f.toLowerCase().includes(q));
    }
    return list;
  }, [families, recents, fav, cats, tab, cat, fontQuery]);

  const weightOf = (family: string) => {
    const w = fonts.filter(f => f.family === family).map(f => f.weight);
    return w.length ? `${Math.min(...w)}–${Math.max(...w)}` : '—';
  };

  const pickFont = async (family: string) => {
    setActiveFont(family);
    await TextStudio.pushRecentFont(family);
    setRecents(await TextStudio.recentFonts());
    await applyToActive(id => TextStudio.setStyle(id, null, {font: family}), `${s.textStudio.font}: ${family}`);
  };

  const toggleFav = async (family: string) => {
    const on = await TextStudio.toggleFontFavorite(family);
    setFav(await TextStudio.fontFavorites());
    void on;
  };

  const applyPresetPack = async (preset: TextPreset) => {
    if (!active) {
      await addText();
    }
    const id = getState().activeLayerId;
    if (id == null) {
      return;
    }
    await TextStudio.applyPreset(id, preset);
    History.push(preset.labelAr);
    showToast(s.textStudio.appliedPreset);
  };

  const useFontPair = async (pair: (typeof FONT_PAIRS)[number]) => {
    if (!active) {
      await addText();
    }
    const id = getState().activeLayerId;
    if (id == null) {
      return;
    }
    await TextStudio.setStyle(id, null, {font: pair.headline, weight: 800, size: 96});
    await TextStudio.add({
      text: detectRtl(draft) ? 'النص الأساسي يكمل هنا' : 'Supporting body text goes here',
      x: Math.round((st.doc?.width ?? 1080) * 0.08),
      y: Math.round((st.doc?.height ?? 1080) * 0.3),
      sizePt: 34,
      color: '#101014',
      font: pair.body,
    });
    History.push(`${s.textStudio.fontPairs}: ${pair.labelAr}`);
    showToast(s.textStudio.usePair);
  };

  const runTemplate = async (tpl: (typeof TEXT_TEMPLATES)[number]) => {
    const x = Math.round((st.doc?.width ?? 1080) * 0.1);
    const y = Math.round((st.doc?.height ?? 1080) * 0.18);
    for (const step of tpl.build(x, y)) {
      await runCommand(step.command, step.params);
    }
    History.push(tpl.labelAr);
    showToast(tpl.labelAr);
  };

  // ---- styles --------------------------------------------------------------
  const [charStyles, setCharStyles] = useState<Array<{name: string}>>([]);
  const [paraStyles, setParaStyles] = useState<Array<{name: string}>>([]);
  const reloadStyles = useCallback(async () => {
    try {
      setCharStyles(await TextStudio.characterStyles());
      const reply = await runCommand('type.paragraphStyle', {});
      setParaStyles(reply.styles ?? []);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    reloadStyles();
  }, [reloadStyles]);

  // ---- control values ------------------------------------------------------
  const [fontSize, setFontSize] = useState(64);
  const [weight, setWeight] = useState(400);
  const [tracking, setTracking] = useState(0);
  const [leading, setLeading] = useState(120);
  const [baseline, setBaseline] = useState(0);
  const [align, setAlign] = useState<'left' | 'center' | 'right' | 'justify'>('center');
  const [caps, setCaps] = useState<'normal' | 'small' | 'all'>('normal');
  const [color, setColor] = useState('#101014');
  const [rtl, setRtl] = useState(false);

  const live = (fn: (id: number) => Promise<unknown>) => active && fn(active.id).catch(() => {});

  return (
    <ScrollView style={{flex: 1}} contentContainerStyle={{gap: 14, paddingBottom: 20}}>
      {/* ---------- live editing ---------- */}
      <View style={{gap: 6}}>
        <SectionLabel text={s.textStudio.liveEditing} />
        <Text style={{color: c.textFaint, fontSize: 11.5}}>{s.textStudio.liveHint}</Text>
        <TextInputRow
          value={draft}
          onChange={onDraftChange}
          placeholder={s.text.placeholder}
          multiline
          rtl={dir() === 'rtl' || rtl}
        />
        <View style={{flexDirection: 'row', gap: 8}}>
          {isText ? (
            <Chip label={s.textStudio.updateText} active onPress={() => live(id => TextStudio.setText(id, draft))} />
          ) : (
            <Chip label={`+ ${s.textStudio.addText}`} active onPress={addText} />
          )}
          {isText && (
            <Chip
              label={s.textStudio.rtl}
              active={rtl}
              onPress={() => {
                setRtl(!rtl);
                live(id => TextStudio.setParagraphStyle(id, {direction: rtl ? 'ltr' : 'rtl'}));
              }}
            />
          )}
        </View>
      </View>

      {/* ---------- font browser ---------- */}
      <View style={{gap: 8}}>
        <SectionLabel text={s.textStudio.fontBrowser} />
        <TextInputRow value={fontQuery} onChange={setFontQuery} placeholder={s.textStudio.searchFonts} />
        <Segmented
          options={[
            {value: 'all' as BrowserTab, label: s.textStudio.allFonts},
            {value: 'recent' as BrowserTab, label: s.textStudio.recentFonts},
            {value: 'favorites' as BrowserTab, label: s.textStudio.favoriteFonts},
            {value: 'categories' as BrowserTab, label: s.common.more},
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'categories' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 6}}>
            <Chip label={s.common.all} small active={cat === 'all'} onPress={() => setCat('all')} />
            {Object.keys(cats).map(k => (
              <Chip key={k} label={k} small active={cat === k} onPress={() => setCat(k)} />
            ))}
          </ScrollView>
        )}
        <View style={{gap: 6}}>
          {shownFonts.slice(0, 40).map(family => (
            <FontCard
              key={family}
              family={family}
              weightRange={weightOf(family)}
              selected={activeFont === family}
              favorite={fav.includes(family)}
              onPick={() => pickFont(family)}
              onFav={() => toggleFav(family)}
              c={c}
            />
          ))}
          {shownFonts.length === 0 && <EmptyState glyph="Aa" title={s.textStudio.searchFonts} />}
        </View>
      </View>

      {/* ---------- presets ---------- */}
      <View style={{gap: 8}}>
        <SectionLabel text={s.textStudio.typographyPresets} />
        <PresetRow presets={TEXT_PRESETS} onApply={applyPresetPack} c={c} />
        <SectionLabel text={s.textStudio.socialPresets} />
        <PresetRow presets={SOCIAL_TEXT_PRESETS} onApply={applyPresetPack} c={c} />
        <SectionLabel text={s.textStudio.arabicPresets} />
        <PresetRow presets={ARABIC_TEXT_PRESETS} onApply={applyPresetPack} c={c} />
        <SectionLabel text={s.textStudio.fontPairs} />
        {FONT_PAIRS.map(p => (
          <Pressable
            key={p.label}
            style={[styles.pairCard, {backgroundColor: c.surface, borderColor: c.border}]}
            onPress={() => useFontPair(p)}>
            <Text style={{color: c.text, fontWeight: '800', fontSize: 20}}>Aa ع</Text>
            <View style={{flex: 1}}>
              <Text style={{color: c.text, fontWeight: '700'}}>{p.labelAr}</Text>
              <Text style={{color: c.textDim, fontSize: 11}}>{p.label}</Text>
            </View>
            <Text style={{color: c.accent2, fontWeight: '700', fontSize: 12}}>{s.textStudio.usePair}</Text>
          </Pressable>
        ))}
        <SectionLabel text={s.textStudio.textTemplates} />
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          {TEXT_TEMPLATES.map(tpl => (
            <Chip key={tpl.id} label={tpl.labelAr} onPress={() => runTemplate(tpl)} />
          ))}
        </View>
      </View>

      {/* ---------- controls ---------- */}
      <View style={{gap: 10}}>
        <SectionLabel text={s.textStudio.title} />
        <SliderRow
          label={s.textStudio.size}
          value={fontSize}
          min={8}
          max={400}
          onChange={setFontSize}
          onBegin={() => History.beginCoalesce('tsize')}
          onCommit={v => {
            History.endCoalesce();
            live(id => TextStudio.setStyle(id, null, {size: v}));
            History.push(`${s.textStudio.size} ${Math.round(v)}`);
          }}
        />
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
          <Text style={{color: c.textDim, fontSize: 12.5, fontWeight: '700'}}>{s.textStudio.weight}</Text>
          {[300, 400, 600, 800, 900].map(w => (
            <Chip
              key={w}
              label={String(w)}
              small
              active={weight === w}
              onPress={() => {
                setWeight(w);
                live(id => TextStudio.setStyle(id, null, {weight: w}));
              }}
            />
          ))}
        </View>
        <SliderRow
          label={s.textStudio.tracking}
          value={tracking}
          min={-100}
          max={400}
          format={v => `${Math.round(v)}/1000`}
          onChange={setTracking}
          onBegin={() => History.beginCoalesce('tracking')}
          onCommit={v => {
            History.endCoalesce();
            live(id => TextStudio.setMetrics(id, v));
          }}
        />
        <SliderRow
          label={s.textStudio.kerning}
          value={0}
          min={-200}
          max={200}
          format={v => `${v > 0 ? '+' : ''}${Math.round(v)}`}
          onChange={() => {}}
          onCommit={v => live(id => TextStudio.setKerning(id, v))}
        />
        <SliderRow
          label={s.textStudio.leading}
          value={leading}
          min={60}
          max={300}
          format={v => `${Math.round(v)}%`}
          onChange={setLeading}
          onCommit={v => live(id => TextStudio.setStyle(id, null, {leading: v}))}
        />
        <SliderRow
          label={s.textStudio.baseline}
          value={baseline}
          min={-50}
          max={50}
          format={v => `${v > 0 ? '+' : ''}${Math.round(v)}`}
          onChange={setBaseline}
          onCommit={v => live(id => TextStudio.setBaselineShift(id, v))}
        />
        <View style={{gap: 4}}>
          <Text style={{color: c.textDim, fontSize: 12.5, fontWeight: '700'}}>{s.textStudio.align}</Text>
          <Segmented
            options={[
              {value: 'left' as const, label: s.textStudio.alignLeft},
              {value: 'center' as const, label: s.textStudio.alignCenter},
              {value: 'right' as const, label: s.textStudio.alignRight},
              {value: 'justify' as const, label: s.textStudio.alignJustify},
            ]}
            value={align}
            onChange={v => {
              setAlign(v);
              live(id => TextStudio.setParagraphStyle(id, {align: v}));
            }}
          />
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
          <Text style={{color: c.textDim, fontSize: 12.5, fontWeight: '700'}}>Caps</Text>
          {(['normal', 'small', 'all'] as const).map(cp => (
            <Chip
              key={cp}
              label={cp === 'normal' ? s.textStudio.capsNormal : cp === 'small' ? s.textStudio.capsSmall : s.textStudio.capsAll}
              small
              active={caps === cp}
              onPress={() => {
                setCaps(cp);
                live(id => TextStudio.setStyle(id, null, {caps: cp}));
              }}
            />
          ))}
        </View>
        <View style={{gap: 4}}>
          <Text style={{color: c.textDim, fontSize: 12.5, fontWeight: '700'}}>{s.textStudio.color}</Text>
          <ColorPicker
            value={color}
            onChange={v => {
              setColor(v);
              live(id => TextStudio.setStyle(id, null, {color: v}));
            }}
          />
        </View>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          <Chip label={s.textStudio.horizontal} small onPress={() => live(id => TextStudio.setOrientation(id, 'horizontal'))} />
          <Chip label={s.textStudio.vertical} small onPress={() => live(id => TextStudio.setOrientation(id, 'vertical'))} />
          {['arc', 'bulge', 'flag', 'wave', 'fish'].map(w => (
            <Chip key={w} label={`${s.textStudio.warp}: ${w}`} small onPress={() => live(id => TextStudio.warp(id, w, 40, false))} />
          ))}
        </View>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          <Chip
            label={s.textStudio.stroke}
            small
            onPress={() =>
              live(async id => {
                const spec: EffectSpec = {kind: 'stroke', color, size: 8, position: 'outside', opacity: 100};
                await LayerStyles.upsert(id, spec);
              })
            }
          />
          <Chip
            label={s.textStudio.shadow}
            small
            onPress={() =>
              live(async id => {
                const spec: EffectSpec = {kind: 'dropShadow', color: '#000000', opacity: 55, distance: 10, size: 16, angle: 120};
                await LayerStyles.upsert(id, spec);
              })
            }
          />
        </View>
      </View>

      {/* ---------- character & paragraph styles ---------- */}
      <View style={{gap: 8}}>
        <SectionLabel
          text={s.textStudio.charStyles}
          action={
            <Chip
              label={s.textStudio.newCharStyle}
              small
              onPress={() =>
                active &&
                TextStudio.newCharacterStyle(`Style ${charStyles.length + 1}`, active.id).then(() => reloadStyles())
              }
            />
          }
        />
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
          {charStyles.map(cs => (
            <Chip
              key={cs.name}
              label={cs.name}
              small
              onPress={() => active && applyToActive(id => TextStudio.applyCharacterStyle(id, cs.name), cs.name)}
            />
          ))}
          {charStyles.length === 0 && <Text style={{color: c.textFaint, fontSize: 12}}>—</Text>}
        </View>
        <SectionLabel
          text={s.textStudio.paraStyles}
          action={
            <Chip
              label={s.textStudio.newCharStyle}
              small
              onPress={() =>
                active && TextStudio.newParagraphStyle(`Para ${paraStyles.length + 1}`, active.id).then(() => reloadStyles())
              }
            />
          }
        />
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
          {paraStyles.map(ps => (
            <Chip
              key={ps.name}
              label={ps.name}
              small
              onPress={() => active && applyToActive(id => TextStudio.applyParagraphStyle(id, ps.name), ps.name)}
            />
          ))}
          {paraStyles.length === 0 && <Text style={{color: c.textFaint, fontSize: 12}}>—</Text>}
        </View>
      </View>
    </ScrollView>
  );
}

function FontCard({
  family,
  weightRange,
  selected,
  favorite,
  onPick,
  onFav,
  c,
}: {
  family: string;
  weightRange: string;
  selected: boolean;
  favorite: boolean;
  onPick: () => void;
  onFav: () => void;
  c: Palette;
}) {
  return (
    <Pressable
      onPress={onPick}
      style={[styles.fontCard, {backgroundColor: selected ? c.accentSoft : c.surface, borderColor: selected ? c.accent : c.border}]}>
      <Text style={{color: c.text, fontSize: 22, fontWeight: '600', flex: 1}} numberOfLines={1}>
        {family}
      </Text>
      <Text style={{color: c.textFaint, fontSize: 11}}>{weightRange}</Text>
      <Pressable onPress={onFav} hitSlop={8}>
        <Text style={{color: favorite ? c.warn : c.textFaint, fontSize: 15}}>{favorite ? '★' : '☆'}</Text>
      </Pressable>
    </Pressable>
  );
}

function PresetRow({presets, onApply, c}: {presets: TextPreset[]; onApply: (p: TextPreset) => void; c: Palette}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8}}>
      {presets.map(p => (
        <Pressable
          key={p.id}
          onPress={() => onApply(p)}
          style={[styles.presetCard, {backgroundColor: c.surface, borderColor: c.border}]}>
          <Text style={{color: c.text, fontWeight: '800', fontSize: p.char.size ? Math.min(20, 10 + p.char.size / 12) : 16}}>
            {p.labelAr}
          </Text>
          <Text style={{color: c.textDim, fontSize: 10}}>
            {p.char.size}pt · {p.char.weight ?? 400}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fontCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pairCard: {flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, padding: 12},
  presetCard: {borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, gap: 2, minWidth: 110},
});
