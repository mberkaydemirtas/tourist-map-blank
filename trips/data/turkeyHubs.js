// Basit TR şehir → hub listeleri (gerekçe: offline + hızlı UX)
export const TURKEY = {
  code: 'TR',
  name: 'Türkiye',
  cities: {
    'İstanbul': {
      plane: [
        { code: 'IST', name: 'İstanbul Havalimanı' },
        { code: 'SAW', name: 'Sabiha Gökçen Havalimanı' },
      ],
      bus: [
        { code: 'ESENLER', name: 'Esenler Otogarı' },
        { code: 'HAREM', name: 'Harem Otogarı' },
      ],
      train: [
        { code: 'HALKALI', name: 'Halkalı Garı' },
        { code: 'SÖĞÜTLÜÇEŞME', name: 'Söğütlüçeşme İstasyonu' },
      ],
      car: [],
      walk: [],
    },
    'Ankara': {
      plane: [{ code: 'ESB', name: 'Esenboğa Havalimanı' }],
      bus: [{ code: 'AŞTİ', name: 'AŞTİ Otogarı' }],
      train: [{ code: 'ANKARA_YHT', name: 'Ankara YHT Garı' }],
      car: [], walk: [],
    },
    'İzmir': {
      plane: [{ code: 'ADB', name: 'Adnan Menderes Havalimanı' }],
      bus: [{ code: 'İZMİR_OTOGAR', name: 'İzmir Otogarı' }],
      train: [{ code: 'ALSANCAK', name: 'Alsancak Garı' }],
      car: [], walk: [],
    },
  },
};

export const COUNTRIES = [{ code: 'TR', name: 'Türkiye', data: TURKEY }];
export const TR_CITIES = Object.keys(TURKEY.cities);
export function getHubsFor(city, mode) {
  const c = TURKEY.cities[city];
  if (!c) return [];
  return c[mode] || [];
}
