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
  const gpsPromptDeclined = useRef(false);
  const initialFetched = useRef(false);
  const lastServicesOn = useRef(null);
  const gpsJustTurnedOn = useRef(false);
  const gpsCheckInterval = useRef(null);

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
      await new Promise(r => setTimeout(r, 1000));
      if (await Location.hasServicesEnabledAsync()) return true;
    }
    return false;
  };

  const stopWatching = () => {
    subscription.current?.remove();
    subscription.current = null;
  };

  const startWatching = useCallback(async () => {
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

    let servicesOn = await Location.hasServicesEnabledAsync();
    lastServicesOn.current = servicesOn;

    if (!servicesOn && !gpsPromptDeclined.current) {
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
