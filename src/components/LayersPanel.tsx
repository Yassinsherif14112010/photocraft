/** Layers panel — real layer tree from doc.inspect, with mask/lock/visibility. */
import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {theme} from '../theme';
import {t} from '../i18n';
import {runCommand, setActiveLayer, useEditor} from '../core/DocumentStore';
import type {LayerSummary} from '../core/types';

export function LayersPanel() {
  const s = t();
  const st = useEditor();

  const toggleVisible = (l: LayerSummary) =>
    runCommand('layer.setProps', {layer: l.id, visible: !l.visible});

  const duplicate = (l: LayerSummary) => runCommand('layer.duplicate', {id: l.id});
  const remove = (l: LayerSummary) => runCommand('layer.delete', {layer: l.id});
  const group = () => runCommand('layer.groupLayers', {ids: [st.activeLayerId]});

  return (
    <View style={{flex: 1}}>
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={group}>
          <Text style={styles.btnText}>📁 {s.editor.group}</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => runCommand('layer.new.layer', {})}>
          <Text style={styles.btnText}>+ {s.editor.addLayer}</Text>
        </Pressable>
      </View>
      <ScrollView>
        {st.layers.map(l => (
          <LayerRow
            key={l.id}
            layer={l}
            active={l.id === st.activeLayerId}
            onSelect={() => setActiveLayer(l.id)}
            onToggle={() => toggleVisible(l)}
            onDuplicate={() => duplicate(l)}
            onDelete={() => remove(l)}
          />
        ))}
        {st.layers.length === 0 && <Text style={styles.dim}>{s.editor.layers}</Text>}
      </ScrollView>
    </View>
  );
}

function LayerRow(props: {
  layer: LayerSummary;
  active: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const {layer, active} = props;
  return (
    <View style={[styles.item, active && styles.itemOn]}>
      <Pressable style={styles.itemMain} onPress={props.onSelect}>
        <Pressable onPress={props.onToggle} hitSlop={8}>
          <Text style={styles.eye}>{layer.visible ? '👁' : '—'}</Text>
        </Pressable>
        <View style={{flex: 1}}>
          <Text style={styles.name} numberOfLines={1}>
            {layer.kind === 'group' ? '📁 ' : layer.kind === 'text' ? 'T ' : '🖼 '}
            {layer.name}
          </Text>
          <Text style={styles.meta}>
            {layer.blend} · {Math.round(layer.opacity * 100)}%{layer.hasMask ? ' · ⛨' : ''}
          </Text>
        </View>
      </Pressable>
      <Pressable onPress={props.onDuplicate} hitSlop={6}><Text style={styles.action}>⧉</Text></Pressable>
      <Pressable onPress={props.onDelete} hitSlop={6}><Text style={[styles.action, {color: theme.danger}]}>✕</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 8, marginBottom: 8},
  btn: {backgroundColor: theme.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8},
  btnText: {color: theme.text, fontSize: 12, fontWeight: '600'},
  item: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface,
    borderRadius: 10, padding: 10, marginBottom: 6, gap: 8,
    borderWidth: 1, borderColor: theme.border,
  },
  itemOn: {borderColor: theme.accent, backgroundColor: theme.surface2},
  itemMain: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10},
  eye: {color: theme.text, fontSize: 14},
  name: {color: theme.text, fontWeight: '600', fontSize: 13},
  meta: {color: theme.textDim, fontSize: 11},
  action: {color: theme.textDim, fontSize: 16, paddingHorizontal: 4},
  dim: {color: theme.textDim, padding: 12},
});
