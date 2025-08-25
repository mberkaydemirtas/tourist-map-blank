// src/services/geoService.js
import { autocompleteCities, getPlaceLatLng, nearbyHubs } from '../../map/maps';

// Hafif ISO ülke listesi (kısaltılmış örnek) —
// Tam listeyi src/data/countries-iso.json olarak ekleyip buradan içe aktarabilirsin.
const ISO_COUNTRIES = [
  { code: 'TR', name: 'Türkiye' }, { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' }, { code: 'DE', name: 'Deutschland' },
  { code: 'FR', name: 'France' }, { code: 'IT', name: 'Italia' },
  { code: 'ES', name: 'España' }, { code: 'JP', name: '日本' },
  { code: 'CN', name: '中国' }, { code: 'AE', name: 'United Arab Emirates' },
  // … tam listeyi dilediğin zaman genişlet
];

export function listCountries() {
  return ISO_COUNTRIES.sort((a, b) => a.name.localeCompare(b.name));
}

// Şehir arama (ülke kısıtlı autocomplete)
export async function searchCities({ countryCode, query, sessionToken }) {
  if (!query?.trim()) return [];
  const items = await autocompleteCities({ input: query.trim(), country: countryCode, sessiontoken: sessionToken });
  return items;
}

// Seçilen şehrin koordinatlarını al
export async function getCityCenter(place_id) {
  return await getPlaceLatLng(place_id);
}

// Mod → Google type eşlemesi
function typeForMode(mode) {
  switch (mode) {
    case 'plane': return 'airport';
    case 'train': return 'train_station';
    case 'bus':   return 'bus_station';
    // car/walk hub zorunlu değil — istersek car_rental/parking gösterebiliriz
    case 'car':   return null; // 'car_rental'
    case 'walk':  return null;
    default:      return null;
  }
}

// Şehre göre hub listesi (mode bazlı)
export async function listHubsForCity({ lat, lng, mode }) {
  const type = typeForMode(mode);
  if (!type) return [];
  const hubs = await nearbyHubs({ lat, lng, type });
  // Basit sıralama: çok oylu & yüksek puan
  return hubs.sort((a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0));
}

// En iyi aday seç (örn. Ankara→ESB, İstanbul→IST/SAW genelde en üstte olur)
export function pickDefaultHub(hubs) {
  return hubs?.length ? hubs[0] : null;
}
