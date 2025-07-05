// src/hooks/useLocation.js
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

  // Başlatma flag’i
  const initializing = useRef(false);
  // GPS popup’u bir kez iptal edildiyse bir daha sorma
  const gpsPromptDeclined = useRef(false);

  // GPS servislerinin açılmasını sağlayan dialog, iptal edilirse false döner
  const ensureServicesEnabled = async () => {
    if (await Location.hasServicesEnabledAsync()) return true;

    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      // Kullanıcı “Hayır” dedi
      gpsPromptDeclined.current = true;
      return false;
    }

    // Kullanıcı “Aç” dediyse, 5 saniye içinde gerçek durumu kontrol et
    const start = Date.now();
    while (Date.now() - start < 5000) {
      // 1 saniye bekle
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 1000));
      if (await Location.hasServicesEnabledAsync()) {
        return true;
      }
    }
    return false;
  };

  const startWatching = useCallback(async () => {
    if (initializing.current) return;
    initializing.current = true;

    // 1️⃣ İzin iste
    const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      if (!canAskAgain && onPermissionPermanentlyDenied) {
        onPermissionPermanentlyDenied();
      }
      setAvailable(false);
      onLocationUnavailable?.();
      return;
    }

    // 2️⃣ GPS kontrolü: eğer daha önce popup iptal edildiyse doğrudan konumsuz moda geç
    if (!await Location.hasServicesEnabledAsync()) {
      if (!gpsPromptDeclined.current) {
        // Popup göster ve sonucu bekle
        const enabled = await ensureServicesEnabled();
        if (!enabled) {
          // Kullanıcı iptal etti, konumsuz moda devam
          setAvailable(false);
          onLocationUnavailable?.();
          return;
        }
      } else {
        // Daha önce iptal etti → doğrudan konumsuz moda devam
        setAvailable(false);
        onLocationUnavailable?.();
        return;
      }
    }

    // 3️⃣ GPS açık → konum al ve takibe geç
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const position = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setCoords(position);
      setAvailable(true);
      onLocationUpdate?.(position);
    } catch {
      setAvailable(false);
      onLocationUnavailable?.();
      return;
    }

    subscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 2000,
        distanceInterval: 2,
      },
      loc => {
        const position = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setCoords(position);
        setAvailable(true);
        onLocationUpdate?.(position);
      },
      () => {
        setAvailable(false);
        onLocationUnavailable?.();
      }
    );
  }, []);

  useEffect(() => {
    startWatching();

    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        // Uygulama geri aktif olduğunda yeniden dene
        initializing.current = false;
        startWatching();
      }
    });

    return () => {
      sub.remove();
      subscription.current?.remove();
      subscription.current = null;
    };
  }, [startWatching]);

  return { coords, available, refreshLocation: startWatching };
}
