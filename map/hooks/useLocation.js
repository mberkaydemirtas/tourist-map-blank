import { useEffect, useRef, useState, useCallback } from 'react';
import * as Location from 'expo-location';
import { AppState } from 'react-native';

export function useLocation(
  onLocationUpdate,
  onLocationUnavailable,
  onPermissionPermanentlyDenied,
  onGPSAvailable
) {
  const subscription = useRef(null);
  const [coords, setCoords] = useState(null);
  const [available, setAvailable] = useState(false);

  const permissionAsked = useRef(false);
  const gpsPromptShown = useRef(false);
  const gpsJustTurnedOn = useRef(false);
  const gpsCheckInterval = useRef(null);
  const lastServicesOn = useRef(null);
  const initialFetched = useRef(false);

  const stopWatching = () => {
    subscription.current?.remove();
    subscription.current = null;
  };

  const ensureServicesEnabled = async () => {
    const status = await Location.hasServicesEnabledAsync();
    if (status) {
      gpsPromptShown.current = false;
      return true;
    }

    if (!gpsPromptShown.current) {
      gpsPromptShown.current = true;
      try {
        await Location.enableNetworkProviderAsync();
      } catch {
        return false;
      }

      const start = Date.now();
      while (Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 1000));
        if (await Location.hasServicesEnabledAsync()) {
          gpsPromptShown.current = false;
          return true;
        }
      }
    }

    return false;
  };

  const startWatching = useCallback(async () => {
    // Her seferde izin durumu kontrol edilmeli
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();

    if (status !== 'granted') {
      permissionAsked.current = true;

      const { status: newStatus, canAskAgain: newCanAskAgain } = await Location.requestForegroundPermissionsAsync();

      if (newStatus !== 'granted') {
        stopWatching();
        setCoords(null);
        setAvailable(false);

        if (!newCanAskAgain && onPermissionPermanentlyDenied) {
          onPermissionPermanentlyDenied();
        }

        onLocationUnavailable?.();
        return; // ⛔️ İzin yoksa GPS açtırmaya çalışma
      }
    }

    permissionAsked.current = true;

    let servicesOn = await Location.hasServicesEnabledAsync();
    lastServicesOn.current = servicesOn;

    if (!servicesOn) {
      const enabled = await ensureServicesEnabled();
      if (!enabled) {
        stopWatching();
        setCoords(null);
        setAvailable(false);
        onLocationUnavailable?.();
        return;
      }
      servicesOn = true;
    }

    if (!initialFetched.current) {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setCoords(p);
        setAvailable(true);
        onLocationUpdate?.(p);
        initialFetched.current = true;
      } catch {
        setCoords(null);
        setAvailable(false);
        onLocationUnavailable?.();
      }
    }

    if (!subscription.current) {
      try {
        subscription.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 2 },
          loc => {
            const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
            setCoords(p);
            setAvailable(true);
            onLocationUpdate?.(p);
          },
          error => {
            console.warn('Watch error:', error);
            stopWatching();
            setCoords(null);
            setAvailable(false);
            onLocationUnavailable?.();
          }
        );
      } catch (error) {
        console.warn('Failed to start watching location:', error);
      }
    }
  }, [onLocationUpdate, onLocationUnavailable, onPermissionPermanentlyDenied]);

  useEffect(() => {
    startWatching();

    const appSub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        startWatching();
      }
    });

    gpsCheckInterval.current = setInterval(async () => {
      const servicesOn = await Location.hasServicesEnabledAsync();

      if (lastServicesOn.current !== servicesOn) {
        lastServicesOn.current = servicesOn;

        if (!servicesOn) {
          stopWatching();
          setCoords(null);
          setAvailable(false);
          gpsJustTurnedOn.current = false;
          gpsPromptShown.current = false;
          onLocationUnavailable?.();
        } else {
          if (!gpsJustTurnedOn.current) {
            gpsJustTurnedOn.current = true;
            await startWatching();
            try {
              const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
              const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
              setCoords(p);
              setAvailable(true);
              onGPSAvailable?.(p);
            } catch {
              console.warn('GPS turned on but failed to get location');
            }
          }
        }
      }
    }, 3000);

    return () => {
      appSub.remove();
      stopWatching();
      clearInterval(gpsCheckInterval.current);
    };
  }, [startWatching, onLocationUnavailable]);

  return { coords, available, refreshLocation: startWatching };
}
