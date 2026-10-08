/** Smart Resize screen — social presets with safe-area preview + layer report. */
import React, {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {theme} from '../theme';
import {t} from '../i18n';
import {SmartResize} from '../core/engines/SmartResize';
import type {ResizeReport} from '../core/engines/SmartResize';
import type {SmartPreset} from '../core/types';
import type {Route} from '../App';

export function SmartResizeScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const s = t();
  const [sel, setSel] = useState<SmartPreset | null>(null);
  const [report, setReport] = useState<ResizeReport | null>(null);

  const apply = async () => {
    if (!sel) {
      return;
    }
    const r = await SmartResize.apply(sel);
    setReport(r);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>{s.smart.title}</Text>
      {SmartResize.presets().map(p => (
        <Pressable key={p.id} style={[styles.card, sel?.id === p.id && styles.cardOn]} onPress={() => setSel(p)}>
          <View style={[styles.aspectBox, {aspectRatio: p.width / p.height}]}>
            {/* safe-area guide preview */}
            <View style={[styles.safe, {margin: `${Math.round(p.safeAreaPct)}%`} as any]} />
          </View>
          <View style={{flex: 1}}>
            <Text style={styles.name}>{p.labelAr}</Text>
            <Text style={styles.dim}>{p.label} · {p.width}×{p.height} · {s.editor.safeArea} {p.safeAreaPct}%</Text>
          </View>
        </Pressable>
      ))}

      {report && (
        <View style={styles.report}>
          <Text style={styles.reportLine}>{s.smart.moved}: {report.scaled}</Text>
          <Text style={styles.reportLine}>{s.smart.reflowed}: {report.reflowed}</Text>
        </View>
      )}

      <Pressable style={[styles.primary, !sel && {opacity: 0.4}]} onPress={apply} disabled={!sel}>
        <Text style={styles.primaryText}>{s.smart.apply}</Text>
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
  card: {
    flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: theme.surface,
    borderRadius: theme.radius, padding: 12, borderWidth: 1, borderColor: theme.border,
  },
  cardOn: {borderColor: theme.accent},
  aspectBox: {
    width: 64, backgroundColor: theme.surface2, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  safe: {flex: 1, borderWidth: 1.5, borderColor: theme.accent2, borderStyle: 'dashed', borderRadius: 4},
  name: {color: theme.text, fontWeight: '700'},
  dim: {color: theme.textDim, fontSize: 12},
  report: {backgroundColor: theme.surface, borderRadius: theme.radius, padding: 14, gap: 4},
  reportLine: {color: theme.text, fontSize: 13},
  primary: {backgroundColor: theme.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 14},
  primaryText: {color: '#fff', fontWeight: '800', fontSize: 16},
  back: {alignItems: 'center', padding: 8},
  backText: {color: theme.accent2, fontWeight: '600'},
});
