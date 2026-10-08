/**
 * Export Center — the professional export system over the engine's real
 * writers: PNG / JPG / WEBP / PSD / PSB (+ .pcraft projects). Includes named
 * presets, batch export across checked formats, quality/compression controls,
 * transparency (real background-visibility toggle in ExportCenter), metadata
 * (title/author/description/keywords/copyright → file.fileInfo), an honest
 * estimated-size hint, and a persisted export history.
 */
import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {t} from '../i18n';
import {useEditor} from '../core/DocumentStore';
import {ExportCenter, QUALITY_PRESETS} from '../core/engines/ExportCenter';
import type {ExportFormat, ExportOptions} from '../core/engines/ExportCenter';
import {EXPORT_PROFILES} from '../core/engines/ExportCenter';
import {ExportHistory, estimateBytes, formatBytes} from '../core/ExportHistory';
import type {ExportHistoryItem} from '../core/ExportHistory';
import {
  Card,
  Chip,
  PrimaryButton,
  SectionLabel,
  SliderRow,
  SwitchRow,
  TextInputRow,
  TopBar,
  Badge,
  EmptyState,
  showToast,
} from '../components/ui';
import type {Route} from '../App';

const FORMATS: ExportFormat[] = ['png', 'jpg', 'webp', 'psd', 'psb', 'pcraft'];

export function ExportScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const c = useTheme();
  const s = t();
  const insets = useSafeAreaInsets();
  const st = useEditor();

  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(92);
  const [transparent, setTransparent] = useState(true);
  const [scalePct, setScalePct] = useState(100);
  const [batchFormats, setBatchFormats] = useState<Set<ExportFormat>>(new Set(['png']));
  const [batchMode, setBatchMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ExportHistoryItem[]>([]);

  const [meta, setMeta] = useState<{title: string; author: string; description: string; keywords: string; copyright: string}>({
    title: '', author: '', description: '', keywords: '', copyright: '',
  });
  const [metaOpen, setMetaOpen] = useState(false);

  useEffect(() => {
    ExportHistory.list().then(setHistory);
    if (st.sessionId != null) {
      ExportCenter.getMetadata(st.sessionId)
        .then((m: any) => {
          setMeta(prev => ({
            ...prev,
            title: m?.title ? String(m.title) : prev.title,
            author: m?.author ? String(m.author) : prev.author,
            description: m?.description ? String(m.description) : prev.description,
            keywords: Array.isArray(m?.keywords) ? m.keywords.join(', ') : prev.keywords,
            copyright: m?.copyright ? String(m.copyright) : prev.copyright,
          }));
        })
        .catch(() => {});
    }
  }, [st.sessionId]);

  const buildOpts = (f: ExportFormat): ExportOptions => ({
    format: f,
    quality,
    transparent: transparent && (f === 'png' || f === 'webp'),
    scalePct,
  });

  const estimate = st.doc ? estimateBytes(format, st.doc.width, st.doc.height, scalePct, quality) : 0;

  const run = async () => {
    if (st.sessionId == null) {
      return;
    }
    setBusy(true);
    try {
      if (metaOpen || meta.title || meta.author) {
        await ExportCenter.setMetadata(st.sessionId, {
          title: meta.title || undefined,
          author: meta.author || undefined,
          description: meta.description || undefined,
          keywords: meta.keywords ? meta.keywords.split(',').map(k => k.trim()).filter(Boolean) : undefined,
          copyright: meta.copyright || undefined,
        });
      }
      const jobs = batchMode ? [...batchFormats] : [format];
      const results = [];
      for (const f of jobs) {
        results.push(await ExportCenter.export(st.sessionId, buildOpts(f)));
      }
      for (const r of results) {
        await ExportHistory.add({
          path: r.path,
          format: r.path.split('.').pop() ?? 'bin',
          bytes: r.bytes,
          at: Date.now(),
          docName: st.docName,
          width: st.doc?.width ?? 0,
          height: st.doc?.height ?? 0,
        });
      }
      setHistory(await ExportHistory.list());
      showToast(batchMode ? `${s.exportScreen.batchDone} (${results.length})` : s.exportScreen.exported);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const flat = format === 'png' || format === 'jpg' || format === 'webp';

  return (
    <View style={[styles.root, {backgroundColor: c.bg, paddingTop: insets.top}]}>
      <TopBar title={s.exportScreen.title} subtitle={s.exportScreen.subtitle} onBack={() => onNavigate('editor')} />

      <ScrollView contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 20}]}>
        {/* presets */}
        <SectionLabel text={s.exportScreen.presets} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8}}>
          {EXPORT_PROFILES.map(p => (
            <Chip
              key={p.id}
              label={p.nameAr}
              onPress={() => {
                setFormat(p.opts.format);
                setQuality(p.opts.quality ?? 92);
                setTransparent(p.opts.transparent ?? false);
                setScalePct(p.opts.scalePct ?? 100);
                setBatchMode(false);
              }}
            />
          ))}
        </ScrollView>

        {/* batch toggle */}
        <SwitchRow label={s.exportScreen.batch} value={batchMode} onChange={setBatchMode} />
        {batchMode && (
          <>
            <Text style={{color: c.textFaint, fontSize: 11}}>{s.exportScreen.batchHint}</Text>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
              {FORMATS.map(f => (
                <Chip
                  key={f}
                  label={f.toUpperCase()}
                  small
                  active={batchFormats.has(f)}
                  onPress={() =>
                    setBatchFormats(prev => {
                      const next = new Set(prev);
                      if (next.has(f)) {
                        next.delete(f);
                      } else {
                        next.add(f);
                      }
                      return next;
                    })
                  }
                />
              ))}
            </View>
          </>
        )}

        {!batchMode && (
          <>
            {/* format */}
            <SectionLabel text={s.exportScreen.format} />
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
              {FORMATS.map(f => (
                <Chip key={f} label={f.toUpperCase()} active={format === f} onPress={() => setFormat(f)} />
              ))}
            </View>

            {flat && (
              <>
                <SectionLabel text={s.exportScreen.quality} />
                <View style={{flexDirection: 'row', gap: 8}}>
                  {QUALITY_PRESETS.map(q => (
                    <Chip key={q.value} label={q.labelAr} active={quality === q.value} onPress={() => setQuality(q.value)} />
                  ))}
                </View>
                {(format === 'png' || format === 'webp') && (
                  <SwitchRow label={s.exportScreen.transparent} value={transparent} onChange={setTransparent} />
                )}
              </>
            )}

            <SliderRow
              label={s.exportScreen.scale}
              value={scalePct}
              min={10}
              max={400}
              step={5}
              onChange={setScalePct}
              format={v => `${Math.round(v)}%`}
            />

            {/* estimate */}
            <Card style={styles.estimateCard}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                <Text style={{color: c.textDim, fontSize: 12.5, fontWeight: '700'}}>{s.exportScreen.estimate}</Text>
                <Badge text="≈" tone="warn" />
              </View>
              <Text style={{color: c.text, fontSize: 22, fontWeight: '900'}}>{formatBytes(estimate)}</Text>
              <Text style={{color: c.textFaint, fontSize: 10.5}}>{s.exportScreen.estimateHint}</Text>
            </Card>
          </>
        )}

        {/* metadata */}
        <Card>
          <Pressable onPress={() => setMetaOpen(!metaOpen)} style={styles.metaHead}>
            <SectionLabel text={s.exportScreen.metadata} />
            <Text style={{color: c.accent2, fontWeight: '800'}}>{metaOpen ? '−' : '+'}</Text>
          </Pressable>
          <Text style={{color: c.textFaint, fontSize: 11, marginTop: 4}}>{s.exportScreen.metadataHint}</Text>
          {metaOpen && (
            <View style={{gap: 10, marginTop: 10}}>
              <TextInputRow value={meta.title} onChange={v => setMeta({...meta, title: v})} placeholder={s.exportScreen.titleField} />
              <TextInputRow value={meta.author} onChange={v => setMeta({...meta, author: v})} placeholder={s.exportScreen.author} />
              <TextInputRow value={meta.description} onChange={v => setMeta({...meta, description: v})} placeholder={s.exportScreen.description} multiline />
              <TextInputRow value={meta.keywords} onChange={v => setMeta({...meta, keywords: v})} placeholder={s.exportScreen.keywords} />
              <TextInputRow value={meta.copyright} onChange={v => setMeta({...meta, copyright: v})} placeholder={s.exportScreen.copyright} />
            </View>
          )}
        </Card>

        <PrimaryButton label={busy ? s.common.busy : batchMode ? `${s.exportScreen.save} ×${batchFormats.size}` : s.exportScreen.save} onPress={run} disabled={busy} />

        {/* history */}
        <SectionLabel
          text={s.exportScreen.history}
          action={
            history.length > 0 ? (
              <Pressable onPress={() => ExportHistory.clear().then(() => setHistory([]))}>
                <Text style={{color: c.danger, fontSize: 12, fontWeight: '700'}}>{s.common.delete}</Text>
              </Pressable>
            ) : undefined
          }
        />
        {history.length === 0 && <EmptyState glyph="⤴" title={s.exportScreen.historyEmpty} />}
        {history.map(h => (
          <Card key={h.id} style={styles.historyRow}>
            <Badge text={h.format.toUpperCase()} tone="accent" />
            <View style={{flex: 1, gap: 2}}>
              <Text style={{color: c.text, fontSize: 12.5, fontWeight: '700'}} numberOfLines={1}>
                {h.docName} · {h.width}×{h.height}
              </Text>
              <Text style={{color: c.textFaint, fontSize: 10.5}} numberOfLines={1}>
                {h.path}
              </Text>
            </View>
            <View style={{alignItems: 'flex-end', gap: 2}}>
              <Text style={{color: c.textDim, fontSize: 11, fontWeight: '700'}}>{formatBytes(h.bytes)}</Text>
              <Text style={{color: c.textFaint, fontSize: 10}}>{new Date(h.at).toLocaleTimeString()}</Text>
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {padding: 16, gap: 14},
  estimateCard: {gap: 4, alignItems: 'flex-start'},
  metaHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%'},
  historyRow: {flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10},
});
