/** Compact color picker: swatch grid + free hex input. */
import React, {useState} from 'react';
import {TextInput, View, StyleSheet, Text, Pressable} from 'react-native';
import {theme} from '../theme';

const SWATCHES = [
  '#101014', '#FFFFFF', '#EF4444', '#F97316', '#F59E0B', '#84CC16',
  '#10B981', '#22D3EE', '#3B82F6', '#6366F1', '#A855F7', '#EC4899',
  '#64748B', '#0F172A', '#7F1D1D', '#78350F', '#14532D', '#1E3A8A',
];

export function ColorPicker({value, onChange}: {value: string; onChange: (hex: string) => void}) {
  const [hex, setHex] = useState(value);
  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {SWATCHES.map(c => (
          <Pressable key={c} style={[styles.swatch, {backgroundColor: c}, value === c && styles.on]} onPress={() => onChange(c)} />
        ))}
      </View>
      <View style={styles.row}>
        <View style={[styles.preview, {backgroundColor: value}]} />
        <TextInput
          style={styles.input}
          value={hex}
          onChangeText={t => {
            setHex(t);
            if (/^#[0-9a-fA-F]{6}$/.test(t)) {
              onChange(t);
            }
          }}
          placeholder="#RRGGBB"
          placeholderTextColor={theme.textDim}
          autoCapitalize="none"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: 8},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  swatch: {width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: theme.border},
  on: {borderColor: '#fff', borderWidth: 2},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8},
  preview: {width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: theme.border},
  input: {
    flex: 1, backgroundColor: theme.surface2, color: theme.text,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
  },
});
