/**
 * Tutorials — real, task-oriented lessons. Each lesson lists concrete steps
 * that map to actual features (tools, panels, commands) so the content teaches
 * the shipped product, not an idealized one.
 */
import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {t} from '../i18n';
import {Badge, Card, SectionLabel, TopBar} from '../components/ui';
import type {Route} from '../App';

const LESSONS: Array<{id: keyof ReturnType<typeof t>['tutorials']['lessons']; glyph: string}> = [
  {id: 'basics', glyph: '🎨'},
  {id: 'layers', glyph: '▤'},
  {id: 'brand', glyph: '🎨'},
  {id: 'resize', glyph: '📐'},
  {id: 'ai', glyph: '✦'},
  {id: 'export', glyph: '⤴'},
];

export function TutorialsScreen({onNavigate}: {onNavigate: (r: Route) => void}) {
  const c = useTheme();
  const s = t();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, {backgroundColor: c.bg, paddingTop: insets.top}]}>
      <TopBar title={s.tutorials.title} subtitle={s.tutorials.subtitle} onBack={() => onNavigate('home')} />
      <ScrollView contentContainerStyle={[styles.content, {paddingBottom: insets.bottom + 24}]}>
        {LESSONS.map((lesson, i) => {
          const copy = s.tutorials.lessons[lesson.id];
          return (
            <Card key={lesson.id} style={styles.lesson}>
              <View style={styles.lessonHead}>
                <Text style={{fontSize: 26}}>{lesson.glyph}</Text>
                <View style={{flex: 1, gap: 3}}>
                  <Text style={{color: c.text, fontWeight: '800', fontSize: 15}}>{copy.title}</Text>
                  <Badge text={`${s.tutorials.start} · ${i + 1}/${LESSONS.length}`} tone="accent" />
                </View>
              </View>
              <SectionLabel text={s.tutorials.subtitle} />
              <Text style={{color: c.textDim, fontSize: 13, lineHeight: 20}}>{copy.steps}</Text>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {padding: 16, gap: 14},
  lesson: {gap: 10},
  lessonHead: {flexDirection: 'row', alignItems: 'center', gap: 12},
});
