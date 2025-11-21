// trips/hooks/parts/useTripLocationGuard.js
import { useState, useCallback } from 'react';
import { Platform, Linking } from 'react-native';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';

/**
 * Konum izinleri + GPS açık mı kontrolü
 * - permissionPrompt: Modal için state
 * - setPermissionPrompt: Modali manuel kapatmak/ayarlamak için
 * - ensureLocationBeforeStart: Rota başlatmadan önce çağır (true/false döner)
 */
export function useTripLocationGuard() {
  const [permissionPrompt, setPermissionPrompt] = useState(null);

  const promptToEnableGPS = useCallback(() => {
    return new Promise((resolve) => {
      setPermissionPrompt({
        title: 'GPS kapalı',
        message: 'Navigasyon için GPS gerekli.',
        actions: [
          {
            text: 'Vazgeç',
            style: 'secondary',
            onPress: () => {
              setPermissionPrompt(null);
              resolve(false);
            },
          },
          {
            text: 'Ayarlar',
            style: 'primary',
            onPress: async () => {
              setPermissionPrompt(null);
              try {
                if (Platform.OS === 'android') {
                  await IntentLauncher.startActivityAsync(
                    IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS
                  );
                } else {
                  await Linking.openURL('app-settings:');
                }
              } catch {
                // ignore
              }
              resolve(false);
            },
          },
        ],
      });
    });
  }, []);

  const ensureLocationBeforeStart = useCallback(async () => {
    try {
      // İzin var mı?
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        if (req.status !== 'granted') return false;
      }

      // GPS açık mı?
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        return await promptToEnableGPS();
      }
      return true;
    } catch {
      return false;
    }
  }, [promptToEnableGPS]);

  return {
    permissionPrompt,
    setPermissionPrompt,
    ensureLocationBeforeStart,
  };
}
