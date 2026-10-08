/**
 * OCR Workspace — a full review screen over the on-device PaddleOCR pipeline:
 *   - scan the staged inbox image, or scope results to the active layer area
 *   - bounding-box preview overlaid on the image (real detection boxes,
 *     contain-fit mapped onto the displayed image)
 *   - editable results, confidence bars, per-hit language detection
 *   - minimum-confidence filter + convert-to-text-layers (real editable
 *     layers with persisted provenance notes)
 */
import React, {useEffect, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../theme';
import {t} from '../i18n';
import {useEditor} from '../core/DocumentStore';
import {History} from '../core/HistoryManager';
import {OcrEngine} from '../core/engines/OcrEngine';
import type {OcrHit} from '../core/engines/OcrEngine';
import {loadInboxAsDataUrl} from '../core/staging';
import {Badge, EmptyState, FullModal, PrimaryButton, SectionLabel, SliderRow, TextInputRow, showToast} from '../components/ui';

interface Layout {
  cw: number;
  ch: number;
  iw: number;
  ih: number;
}

export function OcrWorkspace({visible, onClose}: {visible: boolean; onClose: () => void}) {
  const c = useTheme();
  const s = t();
  const st = useEditor();
  const [image, setImage] = useState<string | null>(null);
  const [hits, setHits] = useState<OcrHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(true);
  const [minConf, setMinConf] = useState(60);
  const [layout, setLayout] = useState<Layout>({cw: 0, ch: 0, iw: 0, ih: 0});

  useEffect(() => {
    if (visible) {
      loadInboxAsDataUrl().then(img => setImage(img));
      OcrEngine.isReady().then(setReady);
    }
  }, [visible]);

  const active = st.layers.find(l => l.id === st.activeLayerId);

  const scan = async () => {
    if (!image) {
      showToast(s.bg.needImage, 'error');
      return;
    }
    setBusy(true);
    try {
      let results = await OcrEngine.detectAndRecognize(image);
      if (active?.bounds) {
        // scope to the active layer's real bounds (center-in-box filter)
        const b = active.bounds;
        results = results.filter(h => {
          const cx = h.x + h.w / 2;
          const cy = h.y + h.h / 2;
          return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
        });
      }
      setHits(results);
    } catch {
      setReady(await OcrEngine.isReady());
      showToast(s.ocr.notReady, 'error');
    } finally {
      setBusy(false);
    }
  };

  const passing = (hits ?? []).filter(h => h.confidence * 100 >= minConf && h.text.trim());

  const createLayers = async () => {
    if (passing.length === 0) {
      return;
    }
    setBusy(true);
    try {
      const ids = await OcrEngine.createTextLayers(passing);
      History.push(`${s.ocr.created} (${ids.length})`);
      showToast(`${s.ocr.created} (${ids.length})`);
      onClose();
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const confTone = (v: number) => (v > 0.85 ? c.success : v > 0.6 ? c.warn : c.danger);

  // contain-fit mapping image px → container px
  const fitBox = (h: OcrHit) => {
    const {cw, ch, iw, ih} = layout;
    if (!cw || !ch || !iw || !ih) {
      return null;
    }
    const k = Math.min(cw / iw, ch / ih);
    const ox = (cw - iw * k) / 2;
    const oy = (ch - ih * k) / 2;
    return {
      left: ox + h.x * k,
      top: oy + h.y * k,
      width: h.w * k,
      height: h.h * k,
    };
  };

  return (
    <FullModal visible={visible} onClose={onClose} title={s.ocr.title} subtitle={s.ocr.subtitle}>
      {!ready && <Text style={[styles.warn, {color: c.warn}]}>{s.ocr.notReady}</Text>}

      {/* image + bbox preview */}
      {image && (
        <View
          style={[styles.previewWrap, {backgroundColor: c.surface}]}
          onLayout={e => setLayout(prev => ({...prev, cw: e.nativeEvent.layout.width, ch: e.nativeEvent.layout.height}))}>
          <Image
            source={{uri: image}}
            style={styles.previewImg}
            resizeMode="contain"
            onLoad={e => {
              const src = e.nativeEvent.source;
              if (src.width && src.height) {
                setLayout(prev => ({...prev, iw: src.width, ih: src.height}));
              }
            }}
          />
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {(hits ?? []).map((h, i) => {
              const box = fitBox(h);
              if (!box) {
                return null;
              }
              return (
                <View
                  key={i}
                  style={[styles.bbox, box, {borderColor: confTone(h.confidence), backgroundColor: `${confTone(h.confidence)}22`}]}
                />
              );
            })}
          </View>
        </View>
      )}

      <View style={{flexDirection: 'row', gap: 8}}>
        <View style={{flex: 1}}>
          <PrimaryButton label={busy ? s.common.busy : hits ? s.ocr.rescan : s.ocr.scanImage} onPress={scan} disabled={busy || !image} />
        </View>
        <View style={{flex: 1}}>
          <PrimaryButton label={s.ocr.scanSelection} onPress={scan} disabled={busy || !image || !active?.bounds} tone="neutral" />
        </View>
      </View>

      <SliderRow label={s.ocr.minConfidence} value={minConf} min={0} max={100} onChange={setMinConf} format={v => `${Math.round(v)}%`} />

      <SectionLabel text={`${s.ocr.boxes} · ${passing.length}`} />
      <ScrollView style={{flex: 1}} contentContainerStyle={{gap: 8, paddingBottom: 12}}>
        {!hits && <EmptyState glyph="🔍" title={s.ocr.empty} hint={s.ocr.editable} />}
        {(hits ?? []).map((h, i) => {
          const dim = h.confidence * 100 < minConf;
          return (
            <View key={i} style={[styles.hitCard, {backgroundColor: c.surface, borderColor: c.border, opacity: dim ? 0.4 : 1}]}>
              <View style={styles.hitHead}>
                <Badge text={h.language === 'ar' ? s.ocr.langAr : h.language === 'mixed' ? s.ocr.langMixed : s.ocr.langEn} tone="accent" />
                <View style={[styles.confTrack, {backgroundColor: c.surface3}]}>
                  <View style={[styles.confFill, {backgroundColor: confTone(h.confidence), width: `${Math.round(h.confidence * 100)}%` as any}]} />
                </View>
                <Text style={{color: c.textDim, fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] as any}}>
                  {Math.round(h.confidence * 100)}%
                </Text>
              </View>
              <TextInputRow
                value={h.text}
                onChange={v => setHits(prev => prev && prev.map((p, j) => (j === i ? {...p, text: v} : p)))}
                rtl={h.language !== 'en'}
              />
              <Text style={{color: c.textFaint, fontSize: 10.5}}>{s.ocr.provenance}</Text>
            </View>
          );
        })}
      </ScrollView>

      <PrimaryButton label={`${s.ocr.create} (${passing.length})`} onPress={createLayers} disabled={busy || passing.length === 0} />
    </FullModal>
  );
}

const styles = StyleSheet.create({
  warn: {fontSize: 12, fontWeight: '700', marginBottom: 6},
  previewWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    maxHeight: 250,
  },
  previewImg: {width: '100%', height: 230},
  bbox: {position: 'absolute', borderWidth: 1.5, borderRadius: 3},
  hitCard: {borderRadius: 12, borderWidth: 1, padding: 10, gap: 8},
  hitHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
  confTrack: {flex: 1, height: 5, borderRadius: 3, overflow: 'hidden'},
  confFill: {height: '100%', borderRadius: 3},
});
