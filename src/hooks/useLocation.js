import { useEffect, useRef, useState, useCallback } from 'react';
import * as Location from 'expo-location';
import { AppState } from 'react-native';

export function useLocation(
  onLocationUpdate,
  onLocationUnavailable,
  onPermissionPermanentlyDenied
) {
  const subscription = useRef(null);
  const [coords, setCoords] = useState(null);
  const [available, setAvailable] = useState(false);

  const permissionAsked = useRef(false);
  const gpsPromptDeclined = useRef(false);
  const lastServicesOn = useRef(null);
  const gpsCheckInterval = useRef(null);

  // GPS açma dialog ve kontrol (tek sefer)
  const ensureServicesEnabled = async () => {
    if (await Location.hasServicesEnabledAsync()) return true;
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      gpsPromptDeclined.current = true;
      return false;
    }
    const start = Date.now();
    while (Date.now() - start < 5000) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 1000));
      // eslint-disable-next-line no-await-in-loop
      if (await Location.hasServicesEnabledAsync()) return true;
    }
    return false;
  };

  const stopWatching = () => {
    subscription.current?.remove();
    subscription.current = null;
  };

  const startWatching = useCallback(async () => {
    // 1️⃣ İzin (tek sefer)
    if (!permissionAsked.current) {
      permissionAsked.current = true;
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (!canAskAgain && onPermissionPermanentlyDenied) {
          onPermissionPermanentlyDenied();
        }
        setCoords(null);
        setAvailable(false);
        onLocationUnavailable?.();
        return;
      }
    }

    // 2️⃣ GPS servisi kontrolü (tek seferlik prompt)
    let servicesOn = await Location.hasServicesEnabledAsync();
    lastServicesOn.current = servicesOn;

    if (!servicesOn) {
      if (!gpsPromptDeclined.current) {
        servicesOn = await ensureServicesEnabled();
        lastServicesOn.current = servicesOn;
      }
      if (!servicesOn) {
        stopWatching();
        setCoords(null);
        setAvailable(false);
        onLocationUnavailable?.();
        return;
      }
    }

    // 3️⃣ İlk konum
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setCoords(p);
      setAvailable(true);
      onLocationUpdate?.(p);
    } catch {
      setCoords(null);
      setAvailable(false);
      onLocationUnavailable?.();
    }

    // 4️⃣ Hareket takibi
    if (!subscription.current) {
      subscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 2000,
          distanceInterval: 2,
        },
        loc => {
          const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setCoords(p);
          setAvailable(true);
          onLocationUpdate?.(p);
        },
        () => {
          // watchPositionAsync hata callback
          stopWatching();
          setCoords(null);
          setAvailable(false);
          onLocationUnavailable?.();
        }
      );
    }
  }, [
    onLocationUpdate,
    onLocationUnavailable,
    onPermissionPermanentlyDenied,
  ]);

  useEffect(() => {
    // Başlangıçta ve AppState active olduğunda başlat
    startWatching();
    const subAppState = AppState.addEventListener('change', state => {
      if (state === 'active') {
        startWatching();
      }
    });

// GPS durumunu her 3 saniyede bir kontrol et
gpsCheckInterval.current = setInterval(async () => {
  const servicesOn = await Location.hasServicesEnabledAsync();

  if (lastServicesOn.current !== servicesOn) {
    console.log(`[GPS STATUS CHANGE] ${lastServicesOn.current ? 'ON → OFF' : 'OFF → ON'}`);

    lastServicesOn.current = servicesOn;

    if (!servicesOn) {
      // GPS kapandı
      stopWatching();
      setCoords(null);
      setAvailable(false);
      onLocationUnavailable?.();
    } else {
      // GPS açıldı
      await startWatching();
    }
  }
}, 3000);

    return () => {
      subAppState.remove();
      stopWatching();
      clearInterval(gpsCheckInterval.current);
    };
  }, [startWatching, onLocationUnavailable]);

  return { coords, available, refreshLocation: startWatching };
}
