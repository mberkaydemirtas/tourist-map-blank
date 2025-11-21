// trips/hooks/parts/useLocationPermissions.js
import { useCallback } from 'react';
import { Platform, Linking } from 'react-native';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';

/**
 * Eski promptToEnableGPS + ensureLocationBeforeStart mantığı
 * setPermissionPrompt state setter'ını dışarıdan alıyoruz.
 */
export function useLocationPermissions({ setPermissionPrompt }) {
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
                // kullanıcı ayarlara gidemese bile resolve et
              }
              resolve(false);
            },
          },
        ],
      });
    });
  }, [setPermissionPrompt]);

  const ensureLocationBeforeStart = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        if (req.status !== 'granted') return false;
      }

      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        const ok = await promptToEnableGPS();
        return ok;
      }

      return true;
    } catch {
      return false;
    }
  }, [promptToEnableGPS]);

  return {
    ensureLocationBeforeStart,
  };
}
