// App.js

import React from 'react';
import { Platform } from 'react-native';
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MapScreen from './MapScreen';

// Android için eski XMLHttpRequest sorunu öncesi tanım
if (Platform.OS === 'android') {
  global.XMLHttpRequest = global.originalXMLHttpRequest ?? global.XMLHttpRequest;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MapScreen />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
