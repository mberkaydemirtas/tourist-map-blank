// App.js
import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PortalProvider } from '@gorhom/portal';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

// Ekranlar
import HomePage from '../homePage/HomePage';
import MapScreen from './MapScreen'; // mevcut dosyanız (explore modu)

// (İstersen ileride NavigationScreen vb. ekleyebiliriz)
// import NavigationScreen from './src/screens/NavigationScreen';

const Stack = createNativeStackNavigator();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#0B0B0B', // Dark-mode dostu arkaplan
    text: '#FFFFFF',
  },
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* 🔧 BottomSheetModal için zorunlu provider */}
        <BottomSheetModalProvider>
          {/* Portallar (sheet/callout vs.) için */}
          <PortalProvider>
            <StatusBar barStyle="light-content" />
            <NavigationContainer theme={theme}>
              <Stack.Navigator
                initialRouteName="Home"
                screenOptions={{
                  headerShown: false,
                  animation: 'fade',
                }}
              >
                {/* Ana ekran: mini harita + kartlar */}
                <Stack.Screen name="Home" component={HomePage} />

                {/* Explore modu: tam ekran MapScreen */}
                <Stack.Screen
                  name="Map"
                  component={MapScreen}
                  initialParams={{ entryPoint: 'home-preview' }}
                />

                {/*
                // İleride eklemek istersen:
                <Stack.Screen name="Navigation" component={NavigationScreen} />
                */}
              </Stack.Navigator>
            </NavigationContainer>
          </PortalProvider>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
