import * as Location from 'expo-location';

export async function checkLocationReady() {
  try {
    // 1. Konum izni kontrolü
    let { status } = await Location.getForegroundPermissionsAsync();

    if (status !== 'granted') {
      const permission = await Location.requestForegroundPermissionsAsync();
      status = permission.status;
      if (status !== 'granted') {
        console.warn('Konum izni verilmedi.');
        return false;
      }
    }

    // 2. GPS açık mı?
    let gpsEnabled = await Location.hasServicesEnabledAsync();

    if (!gpsEnabled) {
      try {
        // GPS'i açtırmayı dene (Android için çalışır)
        await Location.enableNetworkProviderAsync();
        gpsEnabled = await Location.hasServicesEnabledAsync();
      } catch (error) {
        console.warn('Kullanıcı GPS açmayı iptal etti veya desteklenmiyor.');
        return false;
      }
    }

    // 3. Her şey tamam
    return gpsEnabled;
  } catch (e) {
    console.error('Konum kontrolünde hata:', e);
    return false;
  }
}
