/** Home — new document / open / entry cards to every studio module. */
import React, {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {theme} from '../theme';
import {t} from '../i18n';
import {newDocument, openDocument} from '../core/DocumentStore';
import type {Route} from '../App';

export function HomeScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const s = t();
  const [name, setName] = useState('Untitled');
  const [size, setSize] = useState<[number, number]>([1080, 1080]);

  const create = async () => {
    await newDocument(name || 'Untitled', size[0], size[1]);
    onNavigate('editor');
  };

  const open = async () => {
    // Native document picker lives behind the share/view intents; the common
    // flow: pick a PSD/PNG from Files → openDocument(cache copy).
    await openDocument('/data/data/com.photocraft.mobile/files/inbox/last.psd');
    onNavigate('editor');
  };

  const presets: Array<[number, number, string]> = [
    [1080, 1080, '1:1'],
    [1080, 1920, '9:16'],
    [1200, 630, '1.91:1'],
    [1280, 720, '16:9'],
  ];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.logo}>{s.appName}</Text>
      <Text style={styles.sub}>Photoshop-grade editing, in your pocket</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{s.home.newDoc}</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={s.text.placeholder}
          placeholderTextColor={theme.textDim}
        />
        <View style={styles.row}>
          {presets.map(([w, h, label]) => (
            <Pressable
              key={label}
              style={[styles.chip, size[0] === w && size[1] === h && styles.chipOn]}
              onPress={() => setSize([w, h])}>
              <Text style={[styles.chipText, size[0] === w && size[1] === h && styles.chipTextOn]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={styles.primary} onPress={create}>
          <Text style={styles.primaryText}>{s.home.newDoc} →</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        <Pressable style={styles.tile} onPress={open}>
          <Text style={styles.tileIcon}>📂</Text>
          <Text style={styles.tileText}>{s.home.open}</Text>
        </Pressable>
        <Pressable style={styles.tile} onPress={() => onNavigate('assets')}>
          <Text style={styles.tileIcon}>🧩</Text>
          <Text style={styles.tileText}>{s.home.assets}</Text>
        </Pressable>
        <Pressable style={styles.tile} onPress={() => onNavigate('brand')}>
          <Text style={styles.tileIcon}>🎨</Text>
          <Text style={styles.tileText}>{s.home.brandKit}</Text>
        </Pressable>
        <Pressable style={styles.tile} onPress={() => onNavigate('smart')}>
          <Text style={styles.tileIcon}>📐</Text>
          <Text style={styles.tileText}>{s.editor.smartResize}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
  content: {padding: 20, gap: 16},
  logo: {color: theme.text, fontSize: 34, fontWeight: '800'},
  sub: {color: theme.textDim, fontSize: 14},
  card: {backgroundColor: theme.surface, borderRadius: theme.radius, padding: 16, gap: 12},
  cardTitle: {color: theme.text, fontSize: 18, fontWeight: '700'},
  input: {
    backgroundColor: theme.surface2,
    color: theme.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipOn: {backgroundColor: theme.accent, borderColor: theme.accent},
  chipText: {color: theme.text},
  chipTextOn: {color: '#fff', fontWeight: '700'},
  primary: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 14,
  },
  primaryText: {color: '#fff', fontWeight: '800', fontSize: 16},
  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
  tile: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    padding: 18,
    width: '47%',
    gap: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  tileIcon: {fontSize: 28},
  tileText: {color: theme.text, fontWeight: '600'},
});
