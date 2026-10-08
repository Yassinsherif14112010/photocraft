/**
 * EffectsPanel — the ten Photoshop-grade layer effects with full parametric
 * editors over the real `layer.layerStyle.*` commands: shadows, glows,
 * stroke, overlays (gradient with real stops params + pattern picker from
 * `pattern.list`), satin, bevel & emboss (with contours) — plus copy/paste
 * style, scale effects, show/hide and presets.
 */
import React, {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {Palette, useTheme} from '../theme';
import {t} from '../i18n';
import {useEditor} from '../core/DocumentStore';
import {History} from '../core/HistoryManager';
import {LayerStyles, STYLE_PRESETS} from '../core/engines/LayerStyles';
import type {EffectSpec} from '../core/engines/LayerStyles';
import type {EffectKind} from '../core/types';
import {STYLE_CONTOURS} from '../core/types';
import {Chip, PressableScale, SectionLabel, SliderRow, TextInputRow, EmptyState, showToast} from './ui';
import {ColorPicker} from './ColorPicker';

const ALL_KINDS: EffectKind[] = [
  'dropShadow', 'innerShadow', 'outerGlow', 'innerGlow', 'stroke',
  'colorOverlay', 'gradientOverlay', 'patternOverlay', 'satin', 'bevelEmboss',
];

export function EffectsPanel() {
  const c = useTheme();
  const s = t();
  const st = useEditor();
  const active = st.layers.find(l => l.id === st.activeLayerId);
  const [editing, setEditing] = useState<EffectKind | null>(null);
  const [stack, setStack] = useState<EffectSpec[]>([]);
  const [patterns, setPatterns] = useState<Array<{id: string; name: string}>>([]);

  useEffect(() => {
    if (!active) {
      setStack([]);
      return;
    }
    LayerStyles.read(active.id)
      .then(items =>
        setStack(
          items.map(i => ({
            kind: (i.kind as EffectKind) ?? 'dropShadow',
            color: (i.color as string) ?? '#000000',
            opacity: (i.opacity as number) ?? 60,
            angle: (i.angle as number) ?? 120,
            distance: (i.distance as number) ?? 8,
            size: (i.size as number) ?? 12,
            spread: (i.spread as number) ?? 0,
          })),
        ),
      )
      .catch(() => setStack([]));
    LayerStyles.listPatterns()
      .then(p => setPatterns(p))
      .catch(() => {});
  }, [active?.id, st.canvasVersion]);

  if (!active) {
    return <EmptyState glyph="✨" title={s.editor.emptyLayers} />;
  }

  const applySpec = async (spec: EffectSpec, label: string) => {
    try {
      await LayerStyles.upsert(active.id, spec);
      History.push(label);
      showToast(label);
      setStack(prev => [...prev.filter(e => e.kind !== spec.kind), spec]);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  const nameOf = (k: EffectKind) => (s.effects as Record<string, string>)[k === 'stroke' ? 'strokeEffect' : k] ?? k;

  return (
    <ScrollView style={{flex: 1}} contentContainerStyle={{gap: 14, paddingBottom: 20}}>
      {/* header actions */}
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
        <Chip label={s.effects.copy} small onPress={() => LayerStyles.copy(active.id).then(() => showToast(s.effects.copy))} />
        <Chip label={s.effects.paste} small onPress={() => LayerStyles.paste(active.id).then(() => showToast(s.effects.paste))} />
        <Chip label={s.effects.scaleAll} small onPress={() => LayerStyles.scale(active.id, 120).then(() => History.push(s.effects.scaleAll))} />
        <Chip label={s.effects.disabled} small onPress={() => LayerStyles.setEnabled(active.id, false).then(() => History.push(s.effects.disabled))} />
        <Chip label={s.effects.showAll} small onPress={() => LayerStyles.setEnabled(active.id, true).then(() => History.push(s.effects.showAll))} />
        <Chip
          label={s.effects.clear}
          small
          onPress={() =>
            LayerStyles.clear(active.id).then(() => {
              History.push(s.effects.clear);
              setStack([]);
            })
          }
        />
      </View>

      {/* presets */}
      <View style={{gap: 8}}>
        <SectionLabel text={s.effects.presets} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8}}>
          {STYLE_PRESETS.map(p => (
            <PressableScale key={p.name} onPress={() => LayerStyles.apply(active.id, p.effects).then(() => {
              History.push(p.name);
              showToast(p.name);
            })}>
              <View style={[styles.presetCard, {backgroundColor: c.surface, borderColor: c.border}]}>
                <Text style={{color: c.text, fontWeight: '800'}}>{p.name}</Text>
                <Text style={{color: c.textDim, fontSize: 10.5}} numberOfLines={2}>
                  {p.effects.map(e => nameOf(e.kind)).join(' · ')}
                </Text>
              </View>
            </PressableScale>
          ))}
        </ScrollView>
      </View>

      {/* effect kinds */}
      <View style={{gap: 8}}>
        <SectionLabel text={s.effects.custom} />
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
          {ALL_KINDS.map(k => (
            <Chip key={k} label={nameOf(k)} small active={editing === k} onPress={() => setEditing(editing === k ? null : k)} />
          ))}
        </View>
        {stack.length > 0 && (
          <View style={{gap: 4}}>
            {stack.map(e => (
              <Text key={e.kind} style={{color: c.textDim, fontSize: 11.5}}>
                ✓ {nameOf(e.kind)}
              </Text>
            ))}
          </View>
        )}

        {/* per-effect editors */}
        {editing === 'dropShadow' && <ShadowEditor kind="dropShadow" label={s.effects.dropShadow} onApply={applySpec} c={c} />}
        {editing === 'innerShadow' && <ShadowEditor kind="innerShadow" label={s.effects.innerShadow} onApply={applySpec} c={c} />}
        {editing === 'outerGlow' && <GlowEditor kind="outerGlow" label={s.effects.outerGlow} onApply={applySpec} c={c} />}
        {editing === 'innerGlow' && <GlowEditor kind="innerGlow" label={s.effects.innerGlow} onApply={applySpec} c={c} />}
        {editing === 'stroke' && (
          <StrokeEditor onApply={spec => applySpec(spec, s.effects.strokeEffect)} c={c} />
        )}
        {editing === 'colorOverlay' && <ColorOverlayEditor onApply={spec => applySpec(spec, s.effects.colorOverlay)} c={c} />}
        {editing === 'gradientOverlay' && <GradientEditor onApply={spec => applySpec(spec, s.effects.gradientOverlay)} c={c} />}
        {editing === 'patternOverlay' && (
          <PatternEditor patterns={patterns} onApply={spec => applySpec(spec, s.effects.patternOverlay)} c={c} />
        )}
        {editing === 'satin' && <SatinEditor onApply={spec => applySpec(spec, s.effects.satin)} c={c} />}
        {editing === 'bevelEmboss' && <BevelEditor onApply={spec => applySpec(spec, s.effects.bevelEmboss)} c={c} />}
      </View>
    </ScrollView>
  );
}

// ------------------------------------------------------------ param editors

function ShadowEditor({
  kind,
  label,
  onApply,
  c,
}: {
  kind: EffectKind;
  label: string;
  onApply: (spec: EffectSpec, label: string) => void;
  c: Palette;
}) {
  const [color, setColor] = useState('#000000');
  const [opacity, setOpacity] = useState(55);
  const [angle, setAngle] = useState(120);
  const [distance, setDistance] = useState(14);
  const [size, setSize] = useState(20);
  const [spread, setSpread] = useState(0);
  return (
    <EditorShell label={label} c={c}>
      <ColorMini label="Color" value={color} onChange={setColor} c={c} />
      <SliderRow label="Opacity" value={opacity} min={0} max={100} onChange={setOpacity} onCommit={setOpacity} format={v => `${Math.round(v)}%`} />
      <SliderRow label="Angle" value={angle} min={0} max={360} onChange={setAngle} onCommit={setAngle} format={v => `${Math.round(v)}°`} />
      <SliderRow label="Distance" value={distance} min={0} max={200} onChange={setDistance} onCommit={setDistance} />
      <SliderRow label="Size" value={size} min={0} max={250} onChange={setSize} onCommit={setSize} />
      <SliderRow label="Spread" value={spread} min={0} max={100} onChange={setSpread} onCommit={setSpread} />
      <ApplyBtn
        c={c}
        onPress={() => onApply({kind, color, opacity, angle, distance, size, spread}, label)}
      />
    </EditorShell>
  );
}

function GlowEditor({
  kind,
  label,
  onApply,
  c,
}: {
  kind: EffectKind;
  label: string;
  onApply: (spec: EffectSpec, label: string) => void;
  c: Palette;
}) {
  const [color, setColor] = useState('#22D3EE');
  const [opacity, setOpacity] = useState(85);
  const [size, setSize] = useState(24);
  const [choke, setChoke] = useState(0);
  return (
    <EditorShell label={label} c={c}>
      <ColorMini label="Color" value={color} onChange={setColor} c={c} />
      <SliderRow label="Opacity" value={opacity} min={0} max={100} onChange={setOpacity} onCommit={setOpacity} format={v => `${Math.round(v)}%`} />
      <SliderRow label="Size" value={size} min={0} max={250} onChange={setSize} onCommit={setSize} />
      <SliderRow label="Choke" value={choke} min={0} max={100} onChange={setChoke} onCommit={setChoke} />
      <ApplyBtn c={c} onPress={() => onApply({kind, color, opacity, size, choke, technique: 'softer'}, label)} />
    </EditorShell>
  );
}

function StrokeEditor({onApply, c}: {onApply: (spec: EffectSpec) => void; c: Palette}) {
  const s = t();
  const [color, setColor] = useState('#FFFFFF');
  const [size, setSize] = useState(10);
  const [opacity, setOpacity] = useState(100);
  const [position, setPosition] = useState<'outside' | 'inside' | 'center'>('outside');
  return (
    <EditorShell label={s.effects.strokeEffect} c={c}>
      <ColorMini label={s.effects.color} value={color} onChange={setColor} c={c} />
      <SliderRow label={s.effects.size} value={size} min={1} max={80} onChange={setSize} onCommit={setSize} />
      <SliderRow label={s.effects.opacity} value={opacity} min={0} max={100} onChange={setOpacity} onCommit={setOpacity} format={v => `${Math.round(v)}%`} />
      <View style={{flexDirection: 'row', gap: 6}}>
        {(['outside', 'inside', 'center'] as const).map(p => (
          <Chip key={p} label={(s.effects as Record<string, string>)[p]} small active={position === p} onPress={() => setPosition(p)} />
        ))}
      </View>
      <ApplyBtn c={c} onPress={() => onApply({kind: 'stroke', color, size, opacity, position})} />
    </EditorShell>
  );
}

function ColorOverlayEditor({onApply, c}: {onApply: (spec: EffectSpec) => void; c: Palette}) {
  const s = t();
  const [color, setColor] = useState('#3B82F6');
  const [opacity, setOpacity] = useState(75);
  return (
    <EditorShell label={s.effects.colorOverlay} c={c}>
      <ColorMini label={s.effects.color} value={color} onChange={setColor} c={c} />
      <SliderRow label={s.effects.opacity} value={opacity} min={0} max={100} onChange={setOpacity} onCommit={setOpacity} format={v => `${Math.round(v)}%`} />
      <ApplyBtn c={c} onPress={() => onApply({kind: 'colorOverlay', color, opacity})} />
    </EditorShell>
  );
}

function GradientEditor({onApply, c}: {onApply: (spec: EffectSpec) => void; c: Palette}) {
  const s = t();
  const [from, setFrom] = useState('#F97316');
  const [to, setTo] = useState('#DB2777');
  const [angle, setAngle] = useState(90);
  const [scale, setScale] = useState(100);
  const [opacity, setOpacity] = useState(85);
  const [style, setStyle] = useState<'linear' | 'radial' | 'angle' | 'reflected' | 'diamond'>('linear');
  return (
    <EditorShell label={s.effects.gradientOverlay} c={c}>
      <View style={[styles.gradientBar, {backgroundColor: c.surface3}]}>
        <View style={[styles.gradientFill, {backgroundColor: from, opacity: 0.9}]} />
        <View style={[styles.gradientFill, {backgroundColor: to, flex: 1, opacity: 0.9}]} />
      </View>
      <ColorMini label={s.effects.from} value={from} onChange={setFrom} c={c} />
      <ColorMini label={s.effects.to} value={to} onChange={setTo} c={c} />
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
        {(['linear', 'radial', 'angle', 'reflected', 'diamond'] as const).map(st => (
          <Chip key={st} label={st} small active={style === st} onPress={() => setStyle(st)} />
        ))}
      </View>
      <SliderRow label={s.effects.angle} value={angle} min={0} max={360} onChange={setAngle} onCommit={setAngle} format={v => `${Math.round(v)}°`} />
      <SliderRow label={s.effects.scale} value={scale} min={10} max={150} onChange={setScale} onCommit={setScale} format={v => `${Math.round(v)}%`} />
      <SliderRow label={s.effects.opacity} value={opacity} min={0} max={100} onChange={setOpacity} onCommit={setOpacity} format={v => `${Math.round(v)}%`} />
      <ApplyBtn
        c={c}
        onPress={() =>
          onApply({
            kind: 'gradientOverlay',
            gradient: {from, to, angle, scale, style, opacity},
          })
        }
      />
    </EditorShell>
  );
}

function PatternEditor({
  patterns,
  onApply,
  c,
}: {
  patterns: Array<{id: string; name: string}>;
  onApply: (spec: EffectSpec) => void;
  c: Palette;
}) {
  const s = t();
  const [pattern, setPattern] = useState<string | null>(null);
  const [scale, setScale] = useState(100);
  const [opacity, setOpacity] = useState(100);
  return (
    <EditorShell label={s.effects.patternOverlay} c={c}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 6}}>
        {patterns.map(p => (
          <Chip key={p.id} label={p.name} small active={pattern === p.id} onPress={() => setPattern(p.id)} />
        ))}
        {patterns.length === 0 && <Text style={{color: c.textFaint, fontSize: 12}}>—</Text>}
      </ScrollView>
      <SliderRow label={s.effects.scale} value={scale} min={1} max={400} onChange={setScale} onCommit={setScale} format={v => `${Math.round(v)}%`} />
      <SliderRow label={s.effects.opacity} value={opacity} min={0} max={100} onChange={setOpacity} onCommit={setOpacity} format={v => `${Math.round(v)}%`} />
      <ApplyBtn
        c={c}
        onPress={() => {
          if (!pattern) {
            showToast(s.effects.pattern, 'error');
            return;
          }
          onApply({kind: 'patternOverlay', pattern: {pattern, scale, opacity}});
        }}
      />
    </EditorShell>
  );
}

function SatinEditor({onApply, c}: {onApply: (spec: EffectSpec) => void; c: Palette}) {
  const s = t();
  const [color, setColor] = useState('#1E293B');
  const [opacity, setOpacity] = useState(40);
  const [size, setSize] = useState(10);
  const [angle, setAngle] = useState(19);
  const [distance, setDistance] = useState(11);
  return (
    <EditorShell label={s.effects.satin} c={c}>
      <ColorMini label={s.effects.color} value={color} onChange={setColor} c={c} />
      <SliderRow label={s.effects.opacity} value={opacity} min={0} max={100} onChange={setOpacity} onCommit={setOpacity} format={v => `${Math.round(v)}%`} />
      <SliderRow label={s.effects.size} value={size} min={1} max={100} onChange={setSize} onCommit={setSize} />
      <SliderRow label={s.effects.angle} value={angle} min={-180} max={180} onChange={setAngle} onCommit={setAngle} format={v => `${Math.round(v)}°`} />
      <SliderRow label={s.effects.distance} value={distance} min={1} max={100} onChange={setDistance} onCommit={setDistance} />
      <ApplyBtn c={c} onPress={() => onApply({kind: 'satin', color, opacity, size, angle, distance})} />
    </EditorShell>
  );
}

function BevelEditor({onApply, c}: {onApply: (spec: EffectSpec) => void; c: Palette}) {
  const s = t();
  const [style, setStyle] = useState<'inner' | 'outer' | 'emboss' | 'pillow' | 'stroke'>('inner');
  const [technique, setTechnique] = useState<'smooth' | 'chiselHard' | 'chiselSoft'>('smooth');
  const [depth, setDepth] = useState(300);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [size, setSize] = useState(8);
  const [angle, setAngle] = useState(135);
  const [contour, setContour] = useState<string>('Linear');
  return (
    <EditorShell label={s.effects.bevelEmboss} c={c}>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
        {(['inner', 'outer', 'emboss', 'pillow', 'stroke'] as const).map(st => (
          <Chip key={st} label={st} small active={style === st} onPress={() => setStyle(st)} />
        ))}
      </View>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
        {(['smooth', 'chiselHard', 'chiselSoft'] as const).map(tc => (
          <Chip key={tc} label={tc} small active={technique === tc} onPress={() => setTechnique(tc)} />
        ))}
      </View>
      <SliderRow label={s.effects.depth} value={depth} min={1} max={1000} onChange={setDepth} onCommit={setDepth} />
      <View style={{flexDirection: 'row', gap: 6}}>
        {(['up', 'down'] as const).map(d => (
          <Chip key={d} label={(s.effects as Record<string, string>)[d]} small active={direction === d} onPress={() => setDirection(d)} />
        ))}
      </View>
      <SliderRow label={s.effects.size} value={size} min={0} max={100} onChange={setSize} onCommit={setSize} />
      <SliderRow label={s.effects.angle} value={angle} min={0} max={360} onChange={setAngle} onCommit={setAngle} format={v => `${Math.round(v)}°`} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 6}}>
        {STYLE_CONTOURS.map(ct => (
          <Chip key={ct} label={ct} small active={contour === ct} onPress={() => setContour(ct)} />
        ))}
      </ScrollView>
      <ApplyBtn
        c={c}
        onPress={() =>
          onApply({
            kind: 'bevelEmboss',
            bevel: {style, technique, depth, direction, size, angle, contour},
          })
        }
      />
    </EditorShell>
  );
}

// ----------------------------------------------------------------- shells

function EditorShell({label, children, c}: {label: string; children: React.ReactNode; c: Palette}) {
  return (
    <View style={[styles.shell, {backgroundColor: c.surface, borderColor: c.border}]}>
      <Text style={{color: c.text, fontWeight: '800', marginBottom: 8}}>{label}</Text>
      <View style={{gap: 10}}>{children}</View>
    </View>
  );
}

function ColorMini({label, value, onChange, c}: {label: string; value: string; onChange: (v: string) => void; c: Palette}) {
  return (
    <View style={{gap: 6}}>
      <Text style={{color: c.textDim, fontSize: 12.5, fontWeight: '700'}}>{label}</Text>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
        <View style={[styles.colorPreview, {backgroundColor: value, borderColor: c.border}]} />
        <View style={{flex: 1}}>
          <TextInputRow value={value} onChange={onChange} placeholder="#RRGGBB" />
        </View>
      </View>
      <ColorPicker value={value} onChange={onChange} />
    </View>
  );
}

function ApplyBtn({c, onPress}: {c: Palette; onPress: () => void}) {
  const s = t();
  return (
    <PressableScale onPress={onPress} scaleTo={0.97}>
      <View style={[styles.applyBtn, {backgroundColor: c.accent}]}>
        <Text style={{color: c.onAccent, fontWeight: '800'}}>{s.common.apply}</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  presetCard: {borderRadius: 12, borderWidth: 1, padding: 12, width: 150, gap: 3},
  shell: {borderRadius: 13, borderWidth: 1, padding: 12, gap: 8},
  gradientBar: {height: 22, borderRadius: 8, flexDirection: 'row', overflow: 'hidden'},
  gradientFill: {height: '100%', width: '45%'},
  colorPreview: {width: 34, height: 34, borderRadius: 9, borderWidth: 1},
  applyBtn: {borderRadius: 11, alignItems: 'center', paddingVertical: 11, marginTop: 2},
});
