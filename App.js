// App.js
import React from 'react';
import { Platform, LogBox } from 'react-native';
import 'react-native-gesture-handler';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import MapScreen from './MapScreen';
import PlaceSearchOverlay from './components/PlaceSearchOverlay';

if (Platform.OS === 'android') {
  global.XMLHttpRequest = global.originalXMLHttpRequest ?? global.XMLHttpRequest;
}

LogBox.ignoreLogs([
  'Sending `onAnimatedValueUpdate` with no listeners registered',
]);

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <NavigationContainer>
            <Stack.Navigator initialRouteName="Map" screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Map" component={MapScreen} />
              <Stack.Screen name="PlaceSearchOverlay" component={PlaceSearchOverlay} />
            </Stack.Navigator>
          </NavigationContainer>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
