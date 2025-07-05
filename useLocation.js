// useLocation.js
import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { Alert, AppState } from 'react-native';

export function useLocation(onLocationUpdate, onLocationUnavailable) {
  const subscription = useRef(null);

  const startWatching = async () => {
    // 1️⃣ Ask OS for permission (this shows the proper 3-option dialog)
    const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();

    if (status !== 'granted') {
      console.warn('❌ Location permission:', status);
      if (!canAskAgain) {
        // permanently denied
        Alert.alert(
          'Konum izni gerekli',
          'Lütfen ayarlardan konum izni verin.',
          [
            { text: 'Kapat', style: 'cancel' },
            { text: 'Ayarları Aç', onPress: () => Location.openSettings() },
          ]
        );
      }
      onLocationUnavailable?.();
      return;
    }

    // 2️⃣ Get one initial position
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      onLocationUpdate({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    } catch {
      onLocationUnavailable?.();
    }

    // 3️⃣ Start continuous watching
    if (!subscription.current) {
      subscription.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 1 },
        loc => {
          onLocationUpdate({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        }
      );
    }
  };

  useEffect(() => {
    // initial start
    startWatching();

    // restart when app comes to foreground
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') startWatching();
    });

    return () => {
      sub.remove();
      subscription.current?.remove();
    };
  }, []);
}
