// App.js
import 'react-native-gesture-handler';
import 'react-native-reanimated';
import React from 'react';
import { Platform, StatusBar, LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Ekranlar
import HomePage from '../homePage/HomePage';
import MapScreen from './MapScreen';
import PlaceSearchOverlay from './components/PlaceSearchOverlay';
import NavigationScreen from './screens/NavigationScreen';

// Android debug network fix
if (Platform.OS === 'android') {
  global.XMLHttpRequest = global.originalXMLHttpRequest ?? global.XMLHttpRequest;
}

// Gürültülü logları sustur
LogBox.ignoreLogs([
  'Sending `onAnimatedValueUpdate` with no listeners registered',
]);

const Stack = createNativeStackNavigator();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#0B0B0B',
    text: '#FFFFFF',
  },
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer theme={theme}>
          <StatusBar barStyle="light-content" backgroundColor="#0B0B0B" />
          <BottomSheetModalProvider>
            <Stack.Navigator
              initialRouteName="Home"
              screenOptions={{
                headerShown: false,
                animation: 'fade',
              }}
            >
              {/* Ana sayfa: mini harita + kartlar + Rota Planla */}
              <Stack.Screen name="Home" component={HomePage} />

              {/* Explore modu: tam ekran harita */}
              <Stack.Screen
                name="Map"
                component={MapScreen}
                initialParams={{ entryPoint: 'home-preview' }}
              />

              <Stack.Screen name="PlaceSearchOverlay" component={PlaceSearchOverlay} />
              <Stack.Screen name="NavigationScreen" component={NavigationScreen} />
            </Stack.Navigator>
          </BottomSheetModalProvider>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
