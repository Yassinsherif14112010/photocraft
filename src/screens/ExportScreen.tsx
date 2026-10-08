/** Export screen — format/quality/scale/preset + real engine export. */
import React, {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Switch, Text, View} from 'react-native';
import Slider from '@react-native-community/slider';
import {theme} from '../theme';
import {t} from '../i18n';
import {useEditor} from '../core/DocumentStore';
import {ExportCenter, QUALITY_PRESETS} from '../core/engines/ExportCenter';
import type {ExportFormat} from '../core/engines/ExportCenter';
import {SMART_PRESETS} from '../core/types';
import type {Route} from '../App';

const FORMATS: ExportFormat[] = ['png', 'jpg', 'webp', 'psd', 'psb', 'pcraft'];

export function ExportScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const s = t();
  const st = useEditor();
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(92);
  const [transparent, setTransparent] = useState(true);
  const [scalePct, setScalePct] = useState(100);
  const [preset, setPreset] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!st.sessionId) {
      return;
    }
    setErr(null);
    try {
      const res = await ExportCenter.export(st.sessionId, {
        format,
        quality,
        transparent,
        scalePct,
        socialPreset: SMART_PRESETS.find(p => p.id === preset) ?? null,
      });
      setDone(res.path);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  const flat = format === 'png' || format === 'jpg' || format === 'webp';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>{s.exportScreen.title}</Text>

      <Text style={styles.label}>{s.exportScreen.format}</Text>
      <View style={styles.row}>
        {FORMATS.map(f => (
          <Pressable key={f} style={[styles.chip, format === f && styles.chipOn]} onPress={() => setFormat(f)}>
            <Text style={[styles.chipText, format === f && styles.chipTextOn]}>{f.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      {flat && (
        <>
          <Text style={styles.label}>{s.exportScreen.quality}</Text>
          <View style={styles.row}>
            {QUALITY_PRESETS.map(q => (
              <Pressable key={q.value} style={[styles.chip, quality === q.value && styles.chipOn]} onPress={() => setQuality(q.value)}>
                <Text style={[styles.chipText, quality === q.value && styles.chipTextOn]}>{q.label}</Text>
              </Pressable>
            ))}
          </View>
          {(format === 'png' || format === 'webp') && (
            <View style={[styles.row, styles.space]}>
              <Text style={styles.label}>{s.exportScreen.transparent}</Text>
              <Switch value={transparent} onValueChange={setTransparent} trackColor={{true: theme.accent}} />
            </View>
          )}
        </>
      )}

      <Text style={styles.label}>{s.exportScreen.scale}: {scalePct}%</Text>
      <Slider minimumValue={10} maximumValue={200} step={5} value={scalePct} onValueChange={setScalePct} minimumTrackTintColor={theme.accent} />

      <Text style={styles.label}>{s.smart.title}</Text>
      <View style={[styles.row, styles.wrap]}>
        {SMART_PRESETS.map(p => (
          <Pressable
            key={p.id}
            style={[styles.chip, preset === p.id && styles.chipOn]}
            onPress={() => setPreset(preset === p.id ? null : p.id)}>
            <Text style={[styles.chipText, preset === p.id && styles.chipTextOn]}>
              {p.labelAr} · {p.width}×{p.height}
            </Text>
          </Pressable>
        ))}
      </View>

      {done && <Text style={styles.done}>{s.exportScreen.done}: {done}</Text>}
      {err && <Text style={styles.err}>{err}</Text>}

      <Pressable style={styles.primary} onPress={run}>
        <Text style={styles.primaryText}>{s.exportScreen.save}</Text>
      </Pressable>
      <Pressable style={styles.back} onPress={() => onNavigate('editor')}>
        <Text style={styles.backText}>← {s.editor.layers}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
  content: {padding: 20, gap: 12},
  h1: {color: theme.text, fontSize: 26, fontWeight: '800'},
  label: {color: theme.textDim, fontSize: 13, fontWeight: '700'},
  row: {flexDirection: 'row', gap: 8, alignItems: 'center'},
  wrap: {flexWrap: 'wrap'},
  space: {justifyContent: 'space-between'},
  chip: {paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border},
  chipOn: {backgroundColor: theme.accent, borderColor: theme.accent},
  chipText: {color: theme.textDim, fontSize: 12, fontWeight: '600'},
  chipTextOn: {color: '#fff'},
  primary: {backgroundColor: theme.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 14, marginTop: 8},
  primaryText: {color: '#fff', fontWeight: '800', fontSize: 16},
  back: {alignItems: 'center', padding: 8},
  backText: {color: theme.accent2, fontWeight: '600'},
  done: {color: theme.success, fontSize: 12},
  err: {color: theme.danger, fontSize: 12},
});
