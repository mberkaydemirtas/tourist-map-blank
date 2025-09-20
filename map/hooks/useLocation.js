import { useEffect, useRef, useState, useCallback } from 'react';
import * as Location from 'expo-location';
import { AppState } from 'react-native';

/**
 * useLocation(
 *   onLocationUpdate,
 *   onLocationUnavailable,
 *   onPermissionPermanentlyDenied,
 *   onGPSAvailable,
 *   options?: { enabled?: boolean }   // ⬅ yeni
 * )
 *
 * options.enabled === false iken konum/izin/GPS istemez; pasif kalır.
 */
export function useLocation(
  onLocationUpdate,
  onLocationUnavailable,
  onPermissionPermanentlyDenied,
  onGPSAvailable,
  options = {} // ⬅ yeni
) {
  const { enabled = true } = options; // ⬅ varsayılan aktif
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

  // ⬅ PASİF modda hiçbir şey yapma
  const shortCircuitIfDisabled = () => {
    if (!enabled) {
      stopWatching();
      setCoords(null);
      setAvailable(false);
      return true;
    }
    return false;
  };

  const ensureServicesEnabled = async () => {
    const status = await Location.hasServicesEnabledAsync();
    if (status) {
      gpsPromptShown.current = false;
      return true;
    }

    // ⬅ PASİF modda GPS açtırmaya çalışma
    if (!enabled) return false;

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
    // ⬅ PASİF modda tamamen çık
    if (shortCircuitIfDisabled()) return;

    // Her seferde izin durumu kontrol edilmeli
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();

    if (status !== 'granted') {
      // ⬅ PASİF modda izin isteme
      if (!enabled) {
        stopWatching();
        setCoords(null);
        setAvailable(false);
        onLocationUnavailable?.();
        return;
      }

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
      const enabledServices = await ensureServicesEnabled();
      if (!enabledServices) {
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
  }, [enabled, onLocationUpdate, onLocationUnavailable, onPermissionPermanentlyDenied]);

  useEffect(() => {
    // ⬅ enabled değişimini dinle
    if (enabled) {
      startWatching();
    } else {
      stopWatching();
      setCoords(null);
      setAvailable(false);
    }

    const appSub = AppState.addEventListener('change', state => {
      if (!enabled) return; // ⬅ pasifken yok say
      if (state === 'active') {
        startWatching();
      }
    });

    // ⬅ pasifken interval kurma
    if (enabled) {
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
    }

    return () => {
      appSub.remove();
      stopWatching();
      if (gpsCheckInterval.current) clearInterval(gpsCheckInterval.current);
    };
  }, [enabled, startWatching, onLocationUnavailable]);

  // refreshLocation pasifte de mevcut olsun ama pasifken no-op kalsın
  const refreshLocation = useCallback(() => {
    if (!enabled) return;
    return startWatching();
  }, [enabled, startWatching]);

  return { coords, available, refreshLocation };
}
