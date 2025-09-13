// map/App.js
import 'react-native-reanimated';            // ⬅️ Reanimated EN ÜSTTE olmalı
import 'react-native-gesture-handler';

import React, { useEffect } from 'react';
import { Platform, StatusBar, Alert, SafeAreaView, Text } from 'react-native'; // ⬅️ SafeAreaView ve Text eklendi
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import NavigationScreen from './screens/NavigationScreen';

// Ekranlar
import HomePage from '../homePage/HomePage';
import MapScreen from './MapScreen';
import TripsListScreen from '../trips/TripsListScreen';
import TripEditorScreen from '../trips/TripEditorScreen';
import CreateTripWizardScreen from '../trips/CreateTripWizardScreen';

// Veri sürücüsü (local-first)
import { setTripsDriver } from '../trips/shared/tripsRepo';
import createAsyncStorageDriver from '../trips/shared/localDrivers/asyncStorageDriver';

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const TripsStack = createNativeStackNavigator();

/** ───────── Error Boundary ───────── */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    console.error('Wizard crash:', err, info);
    try {
      Alert.alert('Bir şeyler ters gitti', String(err?.message ?? err));
    } catch {}
  }
  render() {
    if (this.state.err) {
      return (
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#101014' }}>
          <Text style={{ color: 'white' }}>Bir hata oluştu</Text>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// Sadece Wizard’ı sarmalayan bir wrapper
function WizardWithBoundary(props) {
  return (
    <ErrorBoundary>
      <CreateTripWizardScreen {...props} />
    </ErrorBoundary>
  );
}

function HomeNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Home" component={HomePage} />
      <HomeStack.Screen name="Map" component={MapScreen} />
      <HomeStack.Screen
        name="NavigationScreen"
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
        component={WizardWithBoundary}   // wrapper
        options={{ title: 'Yeni Gezi' }}
      />
      <TripsStack.Screen
        name="TripEditor"
        component={TripEditorScreen}
        options={{ title: 'Gezi Detayı' }}
      />
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
    setTripsDriver(createAsyncStorageDriver());
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
              <Tab.Screen name="Keşfet" component={HomeNavigator} />
              <Tab.Screen name="Gezilerim" component={TripsNavigator} />
            </Tab.Navigator>
          </NavigationContainer>
        </SafeAreaProvider>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
