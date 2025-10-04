// map/App.js
import 'react-native-gesture-handler';
import 'react-native-reanimated';
import '../app/polyfills/normalize';
import { enableScreens } from 'react-native-screens';
import React, { useEffect } from 'react';
import { Platform, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import Ionicons from '@expo/vector-icons/Ionicons';

import NavigationScreen from './screens/NavigationScreen';

// Ekranlar
import HomePage from '../homePage/HomePage';
import MapScreen from './MapScreen';
import TripsListScreen from '../trips/TripsListScreen';
import TripEditorScreen from '../trips/TripEditorScreen';
import CreateTripWizardScreen from '../trips/CreateTripWizardScreen';
import TripPlacesScreen from '../trips/screens/TripPlacesScreen';
import TripReviewScreen from '../trips/screens/TripReviewScreen';
import TripPlansScreen from '../trips/screens/TripPlansScreen';

// Repo kurulumları
import { setTripsDriver } from '../trips/shared/tripsRepo';
import createAsyncStorageDriver from '../trips/localDrivers/asyncStorageDriver';

import { setPlansDriver } from '../trips/shared/plansRepo';
import plansKVDriver from '../trips/localDrivers/plansKVDriver';

enableScreens(false);

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const TripsStack = createNativeStackNavigator();

function HomeNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="Home" component={HomePage} />
      <HomeStack.Screen name="Map" component={MapScreen} />
      <HomeStack.Screen name="NavigationScreen" component={NavigationScreen} options={{ headerShown: false }} />
    </HomeStack.Navigator>
  );
}

function TripsNavigator() {
  return (
      <TripsStack.Navigator screenOptions={{ headerTitleAlign: 'center' }}>
        <TripsStack.Screen name="TripsHome" component={TripsListScreen} options={{ title: 'Gezilerim' }} />
        <TripsStack.Screen name="CreateTripWizard" component={CreateTripWizardScreen} options={{ title: 'Yeni Gezi' }} />
        <TripsStack.Screen name="TripEditor" component={TripEditorScreen} options={{ title: 'Gezi Detayı' }} />
        <TripsStack.Screen name="TripPlacesScreen" component={TripPlacesScreen} />
        <TripsStack.Screen name="TripReview" component={TripReviewScreen} options={{ title: 'Review' }} />
        {/* ⬇️ Burada sadece 'Planlar' başlığını değil, tüm header barını kapatıyoruz */}
        <TripsStack.Screen name="TripPlans" component={TripPlansScreen} options={{ headerShown: false }} />
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
    // Trip ve Plan sürücüleri (kalıcı)
    setTripsDriver(createAsyncStorageDriver());
    setPlansDriver(plansKVDriver());
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
