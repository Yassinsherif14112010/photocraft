/** Brand Kit screen — colors, fonts, logos, templates, reusable styles. */
import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {theme} from '../theme';
import {t} from '../i18n';
import {BrandKitStore} from '../core/engines/BrandKit';
import type {BrandKit} from '../core/engines/BrandKit';
import {useEditor} from '../core/DocumentStore';
import type {Route} from '../App';

export function BrandKitScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const s = t();
  const st = useEditor();
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    BrandKitStore.load().then(setKit);
  }, []);

  if (!kit) {
    return <View style={styles.root} />;
  }

  const applyTemplate = async (id: string) => {
    const tpl = kit.templates.find(tpl => tpl.id === id);
    if (!tpl) {
      return;
    }
    await BrandKitStore.applyTemplate(kit, tpl);
    onNavigate('editor');
  };

  const capture = async () => {
    if (!st.activeLayerId) {
      return;
    }
    const style = await BrandKitStore.captureStyle(st.activeLayerId, `Style ${kit.styles.length + 1}`);
    setKit(await BrandKitStore.load());
    setMsg(`${s.brand.capture}: ${style.name}`);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>{kit.name}</Text>

      <Text style={styles.label}>{s.brand.colors}</Text>
      <View style={styles.swatches}>
        {kit.colors.map(c => (
          <View key={c} style={[styles.swatch, {backgroundColor: c}]} />
        ))}
      </View>

      <Text style={styles.label}>{s.brand.fonts}</Text>
      <View style={styles.row}>
        {kit.fonts.map(f => (
          <View key={f} style={styles.fontChip}><Text style={styles.fontText}>{f}</Text></View>
        ))}
      </View>

      <Text style={styles.label}>{s.brand.templates}</Text>
      {kit.templates.map(tpl => (
        <Pressable key={tpl.id} style={styles.card} onPress={() => applyTemplate(tpl.id)}>
          <Text style={styles.cardTitle}>{tpl.nameAr}</Text>
          <Text style={styles.dim}>{tpl.width}×{tpl.height}</Text>
        </Pressable>
      ))}

      <Text style={styles.label}>{s.brand.styles}</Text>
      {kit.styles.length === 0 && <Text style={styles.dim}>—</Text>}
      {kit.styles.map(st2 => (
        <View key={st2.name} style={styles.card}>
          <Text style={styles.cardTitle}>{st2.name}</Text>
          <Text style={styles.dim}>{st2.effects.map(e => e.kind).join(' · ')}</Text>
        </View>
      ))}

      {msg && <Text style={styles.done}>{msg}</Text>}
      <Pressable style={styles.primary} onPress={capture}>
        <Text style={styles.primaryText}>{s.brand.capture}</Text>
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
  swatches: {flexDirection: 'row', gap: 8, flexWrap: 'wrap'},
  swatch: {width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: theme.border},
  row: {flexDirection: 'row', gap: 8, flexWrap: 'wrap'},
  fontChip: {backgroundColor: theme.surface2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8},
  fontText: {color: theme.text, fontSize: 12, fontWeight: '600'},
  card: {backgroundColor: theme.surface, borderRadius: theme.radius, padding: 14, borderWidth: 1, borderColor: theme.border},
  cardTitle: {color: theme.text, fontWeight: '700'},
  dim: {color: theme.textDim, fontSize: 12},
  done: {color: theme.success, fontSize: 12},
  primary: {backgroundColor: theme.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 14},
  primaryText: {color: '#fff', fontWeight: '800'},
  back: {alignItems: 'center', padding: 8},
  backText: {color: theme.accent2, fontWeight: '600'},
});
