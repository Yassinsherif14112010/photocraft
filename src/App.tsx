/**
 * App — root navigator (lightweight state tabs; no heavy nav dependency).
 * Home ⇄ Editor (+ panels), plus Export / Smart Resize / Assets / Brand Kit.
 */
import React, {useState} from 'react';
import {I18nManager, StatusBar, StyleSheet, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {theme} from './theme';
import {HomeScreen} from './screens/HomeScreen';
import {EditorScreen} from './screens/EditorScreen';
import {ExportScreen} from './screens/ExportScreen';
import {SmartResizeScreen} from './screens/SmartResizeScreen';
import {AssetLibraryScreen} from './screens/AssetLibraryScreen';
import {BrandKitScreen} from './screens/BrandKitScreen';

export type Route = 'home' | 'editor' | 'export' | 'smart' | 'assets' | 'brand';

export default function App() {
  const [route, setRoute] = useState<Route>('home');

  // Arabic ships as a fully mirrored experience.
  if (I18nManager.getConstants().isRTL === false && false) {
    // (kept explicit: toggling RTL requires an app restart via I18nManager.forceRTL
    // in index.js before registerComponent — see src/boot.js)
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <View style={styles.root}>
        {route === 'home' && <HomeScreen onNavigate={setRoute} />}
        {route === 'editor' && <EditorScreen onNavigate={setRoute} />}
        {route === 'export' && <ExportScreen onNavigate={setRoute} />}
        {route === 'smart' && <SmartResizeScreen onNavigate={setRoute} />}
        {route === 'assets' && <AssetLibraryScreen onNavigate={setRoute} />}
        {route === 'brand' && <BrandKitScreen onNavigate={setRoute} />}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: theme.bg},
});
