/**
 * Brand Kit — the dedicated Brand Workspace dashboard: brand colors (add/
 * remove/tap-to-apply), brand fonts, logos (register + place as real layers),
 * brand templates (real engine recipes), reusable styles, and one-tap
 * "Apply brand to project" (replace text colors + fonts across all text
 * layers through real type.setStyle commands). Import/export .pcbrand files.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {t} from '../i18n';
import {getState, useEditor} from '../core/DocumentStore';
import {History} from '../core/HistoryManager';
import {BrandKitStore} from '../core/engines/BrandKit';
import type {BrandKit} from '../core/engines/BrandKit';
import {TextStudio} from '../core/engines/TextStudio';
import {FileIO} from '../native/PhotoCraftEngine';
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  PrimaryButton,
  SectionLabel,
  TextInputRow,
  TopBar,
  showToast,
} from '../components/ui';
import type {Route} from '../App';

export function BrandKitScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const c = useTheme();
  const s = t();
  const insets = useSafeAreaInsets();
  const st = useEditor();
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [colorDraft, setColorDraft] = useState('');
  const [fontDraft, setFontDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setKit(await BrandKitStore.load());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!kit) {
    return <View style={[styles.root, {backgroundColor: c.bg}]} />;
  }

  const applyColorToLayer = async (color: string) => {
    const id = st.activeLayerId;
    if (id == null) {
      showToast(s.textStudio.noTextLayer, 'error');
      return;
    }
    try {
      const layer = st.layers.find(l => l.id === id);
      if (layer?.kind.toLowerCase().includes('text')) {
        await BrandKitStore.applyBrandColorToText(id, color);
      } else {
        await BrandKitStore.applyBrandColor(id, color);
      }
      History.push(`${s.brand.colors}: ${color}`);
      showToast(s.common.success);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  const applyFontToLayer = async (font: string) => {
    const id = st.activeLayerId;
    if (id == null) {
      showToast(s.textStudio.noTextLayer, 'error');
      return;
    }
    try {
      await TextStudio.setStyle(id, null, {font});
      await TextStudio.pushRecentFont(font);
      History.push(`${s.brand.fonts}: ${font}`);
      showToast(s.common.success);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  /** Real project-wide brand application over all text layers. */
  const applyBrandToProject = async () => {
    setBusy(true);
    try {
      const flat: Array<{id: number; kind: string}> = [];
      const walk = (list: typeof st.layers) => {
        for (const l of list) {
          flat.push({id: l.id, kind: l.kind});
          if (l.children) {
            walk(l.children);
          }
        }
      };
      walk(st.layers);
      const primary = kit.colors[1] ?? kit.colors[0];
      let recolored = 0;
      let refonted = 0;
      for (const l of flat) {
        if (l.kind.toLowerCase().includes('text')) {
          await BrandKitStore.applyBrandColorToText(l.id, primary);
          recolored++;
          if (kit.fonts[0]) {
            await TextStudio.setStyle(l.id, null, {font: kit.fonts[0]});
            refonted++;
          }
        }
      }
      History.push(s.brand.applied);
      showToast(`${s.brand.applied} · ${recolored}✓ ${refonted}✓`);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportKit = async () => {
    try {
      const path = await BrandKitStore.exportKit(kit);
      showToast(`${s.brand.exported}: ${path.split('/').pop()}`);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  const importKit = async () => {
    try {
      const path = '/data/data/com.photocraft.mobile/files/brandkit/import.pcbrand';
      const imported = await BrandKitStore.importKit(path);
      setKit(imported);
      showToast(s.brand.imported);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  const capture = async () => {
    const id = st.activeLayerId ?? getState().activeLayerId;
    if (id == null) {
      showToast(s.textStudio.noTextLayer, 'error');
      return;
    }
    const style = await BrandKitStore.captureStyle(id, `Style ${kit.styles.length + 1}`);
    await reload();
    showToast(`${s.brand.capture}: ${style.name}`);
  };

  return (
    <View style={[styles.root, {backgroundColor: c.bg, paddingTop: insets.top}]}>
      <TopBar title={s.brand.title} subtitle={s.brand.subtitle} onBack={() => onNavigate('home')} />
      <ScrollView contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 24}]}>
        {/* dashboard header card */}
        <Card style={styles.dashCard}>
          <Text style={{color: c.text, fontSize: 22, fontWeight: '900'}}>{kit.name}</Text>
          <View style={{flexDirection: 'row', gap: 6, flexWrap: 'wrap'}}>
            <Badge text={`${kit.colors.length} ${s.brand.colors}`} tone="accent" />
            <Badge text={`${kit.fonts.length} ${s.brand.fonts}`} tone="neutral" />
            <Badge text={`${kit.logos.length} ${s.brand.logos}`} tone="neutral" />
            <Badge text={`${kit.styles.length} ${s.brand.styles}`} tone="success" />
          </View>
        </Card>

        {/* quick apply */}
        <View style={{flexDirection: 'row', gap: 8}}>
          <View style={{flex: 1}}>
            <PrimaryButton label={s.brand.applyToProject} onPress={applyBrandToProject} disabled={busy || st.sessionId == null} />
          </View>
        </View>
        <View style={{flexDirection: 'row', gap: 8}}>
          <Chip label={s.brand.applyColors} small onPress={applyBrandToProject} />
          <Chip label={s.brand.applyFonts} small onPress={applyBrandToProject} />
          <Chip label={s.brand.capture} small onPress={capture} />
        </View>

        {/* colors */}
        <SectionLabel
          text={s.brand.colors}
          action={
            <Text style={{color: c.textFaint, fontSize: 11}}>{s.brand.applyColors} →</Text>
          }
        />
        <View style={styles.swatchWrap}>
          {kit.colors.map(color => (
            <Pressable
              key={color}
              style={[styles.swatch, {backgroundColor: color, borderColor: c.border}]}
              onPress={() => applyColorToLayer(color)}
              onLongPress={() => BrandKitStore.removeColor(color).then(reload)}>
              <Text style={[styles.swatchHex, {color: pickContrast(color)}]}>{color}</Text>
            </Pressable>
          ))}
          {kit.colors.length === 0 && <Text style={{color: c.textFaint}}>{s.brand.emptyColors}</Text>}
        </View>
        <View style={{flexDirection: 'row', gap: 8, alignItems: 'center'}}>
          <View style={{flex: 1}}>
            <TextInputRow value={colorDraft} onChange={setColorDraft} placeholder="#RRGGBB" />
          </View>
          <Chip
            label={s.brand.addColor}
            active
            onPress={() => {
              BrandKitStore.addColor(colorDraft).then(() => {
                setColorDraft('');
                reload();
              });
            }}
          />
        </View>

        {/* fonts */}
        <SectionLabel text={s.brand.fonts} />
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          {kit.fonts.map(f => (
            <Pressable key={f} onPress={() => applyFontToLayer(f)} onLongPress={() => BrandKitStore.removeFont(f).then(reload)}>
              <View style={[styles.fontChip, {backgroundColor: c.surface2, borderColor: c.border}]}>
                <Text style={{color: c.text, fontWeight: '800', fontSize: 15}}>{f}</Text>
              </View>
            </Pressable>
          ))}
          {kit.fonts.length === 0 && <Text style={{color: c.textFaint}}>{s.brand.emptyFonts}</Text>}
        </View>
        <View style={{flexDirection: 'row', gap: 8, alignItems: 'center'}}>
          <View style={{flex: 1}}>
            <TextInputRow value={fontDraft} onChange={setFontDraft} placeholder="Font family" />
          </View>
          <Chip
            label={s.common.add}
            active
            onPress={() => {
              BrandKitStore.addFont(fontDraft).then(() => {
                setFontDraft('');
                reload();
              });
            }}
          />
        </View>

        {/* logos */}
        <SectionLabel text={s.brand.logos} />
        {kit.logos.length === 0 && <Text style={{color: c.textFaint, fontSize: 12.5}}>{s.brand.emptyLogos}</Text>}
        {kit.logos.length > 0 && (
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
            {kit.logos.map((path, i) => (
              <Chip
                key={path}
                label={`${s.brand.placeLogo} ${i + 1}`}
                onPress={() => {
                  const doc = getState().doc;
                  BrandKitStore.placeLogo(kit, i, Math.round((doc?.width ?? 1080) / 2), Math.round((doc?.height ?? 1080) / 2))
                    .then(() => showToast(s.brand.placeLogo))
                    .catch((e: any) => showToast(String(e?.message ?? e), 'error'));
                }}
              />
            ))}
          </View>
        )}

        {/* templates */}
        <SectionLabel text={s.brand.templates} />
        {kit.templates.map(tpl => (
          <Card key={tpl.id} onPress={() => BrandKitStore.applyTemplate(kit, tpl).then(() => onNavigate('editor'))} style={styles.tplRow}>
            <View style={{flex: 1}}>
              <Text style={{color: c.text, fontWeight: '800'}}>{tpl.nameAr}</Text>
              <Text style={{color: c.textDim, fontSize: 11.5}}>
                {tpl.width}×{tpl.height} · {tpl.steps.length} steps
              </Text>
            </View>
            <Text style={{color: c.accent2, fontWeight: '800'}}>{s.templates.use} ›</Text>
          </Card>
        ))}

        {/* reusable styles */}
        <SectionLabel text={s.brand.styles} />
        {kit.styles.length === 0 && <EmptyState glyph="✧" title={s.brand.capture} />}
        {kit.styles.map(style => (
          <Card key={style.name} style={styles.tplRow}>
            <View style={{flex: 1}}>
              <Text style={{color: c.text, fontWeight: '700'}}>{style.name}</Text>
              <Text style={{color: c.textDim, fontSize: 11}} numberOfLines={1}>
                {style.effects.map(e => e.kind).join(' · ')}
              </Text>
            </View>
            <Chip
              label={s.common.apply}
              small
              onPress={() => {
                const id = st.activeLayerId;
                if (id == null) {
                  showToast(s.textStudio.noTextLayer, 'error');
                  return;
                }
                BrandKitStore.applyStyle(id, style).then(() => showToast(s.common.success));
              }}
            />
          </Card>
        ))}

        {/* import/export */}
        <View style={{flexDirection: 'row', gap: 8}}>
          <View style={{flex: 1}}>
            <PrimaryButton label={s.brand.exportKit} onPress={exportKit} tone="neutral" />
          </View>
          <View style={{flex: 1}}>
            <PrimaryButton label={s.brand.importKit} onPress={importKit} tone="neutral" />
          </View>
        </View>
        {!FileIO && <Text style={{color: c.warn, fontSize: 11}}>{s.common.error}</Text>}
      </ScrollView>
    </View>
  );
}

/** Simple luminance-based contrast picker for swatch labels. */
function pickContrast(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? '#101014' : '#FFFFFF';
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {padding: 16, gap: 14},
  dashCard: {gap: 10},
  swatchWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  swatch: {width: 64, height: 64, borderRadius: 14, borderWidth: 1, alignItems: 'flex-end', justifyContent: 'flex-end', padding: 4, overflow: 'hidden'},
  swatchHex: {fontSize: 7.5, fontWeight: '800'},
  fontChip: {borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10},
  tplRow: {flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12},
});
