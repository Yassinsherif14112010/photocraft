/**
 * Smart Resize — Canva-quality resizing: platform grid (Instagram, Facebook,
 * TikTok, YouTube, LinkedIn, Pinterest, Snapchat), live aspect preview with
 * safe-zone visualization, cover/contain fit modes, before/after dimensions,
 * platform suggestions ranked by aspect-ratio distance, and the real engine
 * apply pipeline (canvasSize → per-layer transform refit → safe-area guides).
 */
import React, {useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {t} from '../i18n';
import {useEditor} from '../core/DocumentStore';
import {SmartResize} from '../core/engines/SmartResize';
import type {ResizeReport} from '../core/engines/SmartResize';
import {SMART_PRESETS} from '../core/types';
import type {SmartPreset} from '../core/types';
import {
  Badge,
  Card,
  Chip,
  PrimaryButton,
  SectionLabel,
  Segmented,
  TopBar,
  EmptyState,
  showToast,
} from '../components/ui';
import type {Route} from '../App';

export function SmartResizeScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const c = useTheme();
  const s = t();
  const insets = useSafeAreaInsets();
  const st = useEditor();
  const [sel, setSel] = useState<SmartPreset | null>(null);
  const [mode, setMode] = useState<'cover' | 'contain'>('cover');
  const [report, setReport] = useState<ResizeReport | null>(null);
  const [busy, setBusy] = useState(false);

  // suggestions: closest aspect ratios first
  const suggestions = useMemo(() => {
    if (!st.doc) {
      return [];
    }
    const ar = st.doc.width / st.doc.height;
    return [...SMART_PRESETS]
      .map(p => ({p, dist: Math.abs(p.width / p.height - ar)}))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3)
      .map(x => x.p);
  }, [st.doc]);

  const apply = async () => {
    if (!sel) {
      return;
    }
    setBusy(true);
    try {
      const r = await SmartResize.apply(sel, mode);
      setReport(r);
      showToast(`${s.smart.applied} ${sel.width}×${sel.height}`);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const selAr = sel ? sel.width / sel.height : 1;

  return (
    <View style={[styles.root, {backgroundColor: c.bg, paddingTop: insets.top}]}>
      <TopBar title={s.smart.title} subtitle={s.smart.subtitle} onBack={() => onNavigate('editor')} />
      <ScrollView contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 20}]}>
        {/* live preview */}
        <Card style={styles.previewCard}>
          <SectionLabel text={s.smart.preview} />
          <View style={styles.previewRow}>
            {/* before */}
            <View style={styles.previewCol}>
              <Text style={[styles.previewTag, {color: c.textDim}]}>{s.smart.before}</Text>
              <View style={[styles.frame, {backgroundColor: c.surface2, borderColor: c.border, aspectRatio: st.doc ? st.doc.width / st.doc.height : 1}]}>
                {st.doc && (
                  <Text style={{color: c.textFaint, fontSize: 10, fontWeight: '700'}}>
                    {st.doc.width}×{st.doc.height}
                  </Text>
                )}
              </View>
            </View>
            {/* after */}
            <View style={styles.previewCol}>
              <Text style={[styles.previewTag, {color: c.accent2}]}>{s.smart.after}</Text>
              <View style={[styles.frame, {backgroundColor: c.surface2, borderColor: sel ? c.accent : c.border, aspectRatio: selAr}]}>
                {sel && (
                  <>
                    <View
                      style={[styles.safeBox, {borderColor: c.accent2, margin: `${sel.safeAreaPct}%` as any}]}
                    />
                    <Text style={{color: c.textFaint, fontSize: 10, fontWeight: '700', position: 'absolute', bottom: 4}}>
                      {sel.width}×{sel.height}
                    </Text>
                  </>
                )}
                {!sel && <Text style={{color: c.textFaint, fontSize: 10}}>—</Text>}
              </View>
            </View>
          </View>
        </Card>

        {/* suggestions */}
        {suggestions.length > 0 && (
          <View style={{gap: 8}}>
            <SectionLabel text={s.smart.suggestions} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8}}>
              {suggestions.map(p => (
                <Chip key={`sug-${p.id}`} label={`${p.labelAr} ${p.width}×${p.height}`} small active={sel?.id === p.id} onPress={() => setSel(p)} />
              ))}
            </ScrollView>
            <Text style={{color: c.textFaint, fontSize: 10.5}}>{s.smart.suggestReason}</Text>
          </View>
        )}

        {/* fit mode */}
        <View style={{gap: 8}}>
          <SectionLabel text={s.smart.mode} />
          <Segmented
            options={[
              {value: 'cover' as const, label: s.smart.cover},
              {value: 'contain' as const, label: s.smart.contain},
            ]}
            value={mode}
            onChange={setMode}
          />
        </View>

        {/* platform grid */}
        <SectionLabel text={s.smart.dimensions} />
        <View style={{gap: 8}}>
          {SmartResize.presets().map(p => (
            <Card key={p.id} onPress={() => setSel(p)} active={sel?.id === p.id} style={styles.platformRow}>
              <View style={[styles.aspectBox, {backgroundColor: c.surface2, aspectRatio: p.width / p.height}]}>
                <View style={[styles.safeBox, {borderColor: c.accent2, margin: `${Math.round(p.safeAreaPct)}%` as any}]} />
              </View>
              <View style={{flex: 1, gap: 3}}>
                <Text style={{color: c.text, fontWeight: '800'}}>{p.labelAr}</Text>
                <Text style={{color: c.textDim, fontSize: 11.5}}>
                  {p.label} · {p.width}×{p.height}
                </Text>
                <Badge text={`${s.editor.safeArea} ${p.safeAreaPct}%`} tone="accent" />
              </View>
              {suggestions.some(sg => sg.id === p.id) && <Badge text="✦" tone="warn" />}
            </Card>
          ))}
        </View>

        {/* report */}
        {report && (
          <Card style={{gap: 6}}>
            <SectionLabel text={`${s.smart.applied} ${report.to.width}×${report.to.height}`} />
            <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
              <Badge text={`${s.smart.scaled}: ${report.scaled}`} tone="success" />
              <Badge text={`${s.smart.moved}: ${report.moved}`} tone="accent" />
              <Badge text={`${s.smart.reflowed}: ${report.reflowed}`} tone="neutral" />
              <Badge text={`${s.smart.guides}: ${report.guides}`} tone="warn" />
            </View>
          </Card>
        )}

        <PrimaryButton label={busy ? s.common.busy : s.smart.apply} onPress={apply} disabled={!sel || busy} />
        {!st.doc && <EmptyState glyph="📐" title={s.common.error} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {padding: 16, gap: 14},
  previewCard: {gap: 10},
  previewRow: {flexDirection: 'row', gap: 16, alignItems: 'flex-end'},
  previewCol: {flex: 1, gap: 6, alignItems: 'center'},
  previewTag: {fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5},
  frame: {width: '100%', borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'},
  safeBox: {flex: 1, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 6},
  platformRow: {flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10},
  aspectBox: {width: 58, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'},
});
