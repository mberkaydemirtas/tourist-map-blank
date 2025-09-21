// map/App.js
import 'react-native-gesture-handler';     // ✅ 1) EN ÜSTTE
import 'react-native-reanimated';          // ✅ 2) Hemen ardından
import { enableScreens } from 'react-native-screens';
import React, { useEffect } from 'react';
import { Platform, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'; // ✅ sadece bu
import Ionicons from '@expo/vector-icons/Ionicons';
// map/App.js
import NavigationScreen from './screens/NavigationScreen';

// Ekranlar
import HomePage from '../homePage/HomePage';
import MapScreen from './MapScreen';
import TripsListScreen from '../trips/TripsListScreen';
import TripEditorScreen from '../trips/TripEditorScreen';
import CreateTripWizardScreen from '../trips/CreateTripWizardScreen';
import TripPlacesScreen from '../trips/screens/TripPlacesScreen';

// Veri sürücüsü (local-first)
import { setTripsDriver } from '../trips/shared/tripsRepo';
import AsyncStorageDriver from '../trips/localDrivers/asyncStorageDriver';
enableScreens(false); // ✅ sadece teşhis için (crash kesiliyorsa screens kaynaklı)
const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const TripsStack = createNativeStackNavigator();
const Stack = createNativeStackNavigator()

function HomeNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Home" component={HomePage} />
      <HomeStack.Screen name="Map" component={MapScreen} />
      {/* ⬇️ Bunu ekleyin */}
      <HomeStack.Screen
        name="NavigationScreen"      // Route adı navigate ile aynı olsun
        component={NavigationScreen}
        options={{ headerShown: false }}
      />
    </HomeStack.Navigator>
  );
}

function TripsNavigator() {
  return (
    <TripsStack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
      <TripsStack.Screen
        name="TripsHome"
        component={TripsListScreen}
        options={{ title: 'Gezilerim' }}
      />
      <TripsStack.Screen
        name="CreateTripWizard"
        component={CreateTripWizardScreen}
        options={{ title: 'Yeni Gezi' }}
      />
      <TripsStack.Screen
        name="TripEditor"
        component={TripEditorScreen}
        options={{ title: 'Gezi Detayı' }}
      />
      <Stack.Screen name="TripPlacesScreen" component={TripPlacesScreen} />


    </TripsStack.Navigator>
  );
}

// Koyu tema
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#101014',
    card: '#0D0F14',
    text: '#FFFFFF',
    border: '#23262F',
  },
};

export default function App() {
  useEffect(() => {
    setTripsDriver(AsyncStorageDriver());
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* ✅ BottomSheetModalProvider en üstte; portal çakışması yok */}
      <BottomSheetModalProvider>
        <SafeAreaProvider>
          <NavigationContainer theme={navTheme}>
            <StatusBar
              barStyle="light-content"
              backgroundColor={Platform.OS === 'android' ? '#000' : undefined}
            />

            <Tab.Navigator
              screenOptions={({ route }) => ({
                headerShown: false,
                tabBarStyle: {
                  height: 56,
                  backgroundColor: '#0D0F14',
                  borderTopColor: '#23262F',
                },
                tabBarActiveTintColor: '#FFFFFF',
                tabBarInactiveTintColor: '#A8A8B3',
                tabBarLabelStyle: { fontSize: 12 },
                tabBarIcon: ({ color, size, focused }) => {
                  let icon = 'compass-outline';
                  if (route.name === 'Keşfet') icon = focused ? 'compass' : 'compass-outline';
                  if (route.name === 'Gezilerim') icon = focused ? 'calendar' : 'calendar-outline';
                  return <Ionicons name={icon} size={size} color={color} />;
                },
              })}
            >
              {/* 1) Keşfet: Home + Map aynı stack içinde */}
              <Tab.Screen name="Keşfet" component={HomeNavigator} />
              {/* 2) Gezilerim: Liste + Wizard + Editor */}
              <Tab.Screen name="Gezilerim" component={TripsNavigator} />
            </Tab.Navigator>
          </NavigationContainer>
        </SafeAreaProvider>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
