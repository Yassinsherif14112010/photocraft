/**
 * App — root shell: theme initialization (dark/light/system), the screen
 * router, the global toast host and a themed status bar. Arabic ships as a
 * fully mirrored experience (I18nManager at boot).
 */
import React, {useEffect, useState} from 'react';
import {StatusBar, StyleSheet, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {initTheme, useTheme} from './theme';
import {initPaths} from './core/paths';
import {HomeScreen} from './screens/HomeScreen';
import {EditorScreen} from './screens/EditorScreen';
import {ExportScreen} from './screens/ExportScreen';
import {SmartResizeScreen} from './screens/SmartResizeScreen';
import {AssetLibraryScreen} from './screens/AssetLibraryScreen';
import {BrandKitScreen} from './screens/BrandKitScreen';
import {TemplatesScreen} from './screens/TemplatesScreen';
import {TutorialsScreen} from './screens/TutorialsScreen';
import {ToastHost} from './components/ui';

export type Route =
  | 'home'
  | 'editor'
  | 'export'
  | 'smart'
  | 'assets'
  | 'brand'
  | 'templates'
  | 'tutorials';

export default function App() {
  const [route, setRoute] = useState<Route>('home');
  const [ready, setReady] = useState(false);
  const c = useTheme();

  useEffect(() => {
    Promise.all([initTheme(), initPaths()]).then(() => setReady(true));
  }, []);

  // Arabic ships as a fully mirrored experience (forced RTL in index.js).

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={c.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={c.bg}
      />
      <View style={styles.root}>
        {ready && route === 'home' && <HomeScreen onNavigate={setRoute} />}
        {ready && route === 'editor' && <EditorScreen onNavigate={setRoute} />}
        {ready && route === 'export' && <ExportScreen onNavigate={setRoute} />}
        {ready && route === 'smart' && <SmartResizeScreen onNavigate={setRoute} />}
        {ready && route === 'assets' && <AssetLibraryScreen onNavigate={setRoute} />}
        {ready && route === 'brand' && <BrandKitScreen onNavigate={setRoute} />}
        {ready && route === 'templates' && <TemplatesScreen onNavigate={setRoute} />}
        {ready && route === 'tutorials' && <TutorialsScreen onNavigate={setRoute} />}
      </View>
      <ToastHost />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: 'transparent'},
});
