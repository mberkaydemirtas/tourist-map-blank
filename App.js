// App.js
import { Platform } from 'react-native';
if (Platform.OS === 'android') {
  global.XMLHttpRequest = global.originalXMLHttpRequest ?? global.XMLHttpRequest;
}

import 'react-native-gesture-handler';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MapScreen from './MapScreen';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MapScreen />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}