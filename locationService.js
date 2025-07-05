// locationService.js

import { PermissionsAndroid, Platform, Alert, Linking } from 'react-native';
import Geolocation from 'react-native-geolocation-service';

/**
 * Android ve iOS için:
 * 1) Gerekli izinleri ister
 * 2) Bir kereye mahsus konum alarak GPS’in ve servislerin aktifliğini test eder
 */
export async function requestLocationPermission() {
  // Android’de FINE_LOCATION izni
  const hasTriedPermission = useRef(false);
  if (Platform.OS === 'android') {
    const hasFine = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    if (!hasFine) {
      const status = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Konum Erişimi Gerekli',
          message: 'Harita konumunuzu göstermek için izin vermelisiniz.',
          buttonPositive: 'Tamam',
          buttonNegative: 'İptal',
        }
      );
      if (status !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert(
          'İzin Reddedildi',
          'Konum izni verilmeden devam edemezsiniz.',
          [
            { text: 'Ayarları Aç', onPress: () => Linking.openSettings() },
            { text: 'Kapat', style: 'cancel' },
          ]
        );
        if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
  Alert.alert(
    "Konum İzni Gerekli",
    "Lütfen ayarlardan konum iznini etkinleştirin.",
    [
      { text: "İptal", style: "cancel" },
      { text: "Ayarları Aç", onPress: () => Linking.openSettings() },
    ]
  );
}

        return false;
      }
    }
  }
  // iOS’de whenInUse izni
  else {
    const status = await Geolocation.requestAuthorization('whenInUse');
    if (status !== 'granted') {
      Alert.alert(
        'İzin Reddedildi',
        'Konum izni verilmeden devam edemezsiniz.',
        [{ text: 'Kapat', style: 'cancel' }]
      );
      return false;
    }
  }

  // 🔥 Bir kereye mahsus getCurrentPosition çağırarak
  //    • GPS açık mı? konum servisi çalışıyor mu? test et
  //    • eğer kapalıysa Alert ile kullanıcıyı Ayarlar’a yönlendir
  return new Promise(resolve => {
    Geolocation.getCurrentPosition(
      () => resolve(true),
      error => {
        if (error.code === 2) { // Location services disabled
          Alert.alert(
            'Konum Servisleri Kapalı',
            'Lütfen konum servislerini açın.',
            [
              { text: 'Ayarları Aç', onPress: () => Linking.openSettings() },
              { text: 'Kapat', style: 'cancel' },
            ]
          );
        } else {
          console.warn('Konum hatası:', error);
        }
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  });
}

/**
 * İzin verildikten sonra konum değişikliklerini dinleyen fonksiyon.
 * onUpdate callback’ine { latitude, longitude } objesi gönderir.
 * Dönen fonksiyon çağrıldığında watcher durdurulur.
 */
export function initLocationWatcher(onUpdate) {
  const watchId = Geolocation.watchPosition(
    ({ coords }) => {
      onUpdate({ latitude: coords.latitude, longitude: coords.longitude });
    },
    error => console.error('Konum izleme hatası:', error),
    {
      enableHighAccuracy: true,
      distanceFilter: 10,
      interval: 2000,
      fastestInterval: 1000,
    }
  );
  // geri döndürdüğümüz fonksiyon ile cleanup yapabiliriz
  return () => Geolocation.clearWatch(watchId);
}
