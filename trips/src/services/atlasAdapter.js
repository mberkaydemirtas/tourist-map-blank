// trips/src/services/atlasAdapter.js
import { HUBS_BY_COUNTRY, COUNTRY_INDEX } from '../data/atlas';

// TR gibi ülkelerde şehir = state/il
const CITY_FROM_STATES = new Set(['TR']); // gerekirse genişletirsin: ['TR','AE',...]

const UI2DATA = { airport: 'plane', train: 'train', bus: 'bus' };

const norm = (s) => {
  try { return String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  catch { return String(s||'').toLowerCase().trim(); }
};
const trCmp = (a,b) => {
  try { return String(a||'').localeCompare(String(b||''), 'tr', {sensitivity:'base'}); }
  catch { return String(a||'').localeCompare(String(b||'')); }
};

// — Ülke listesi (ülke seçimi)
export function listCountries() {
  return COUNTRY_INDEX.slice(); // {code,name}[]
}

// — Şehir listesi (şehir seçimi)
export function listCityNames(countryCode) {
  const cc = String(countryCode||'').toUpperCase();
  const doc = HUBS_BY_COUNTRY[cc];
  if (!doc) return [];

  // 1) TR gibi ülkelerde state’leri “şehir” gibi göster
  if (CITY_FROM_STATES.has(cc) && Array.isArray(doc.states) && doc.states.length) {
    return doc.states.slice().sort(trCmp);
  }

  // 2) Diğer ülkelerde mevcut city isimleri
  if (!doc?.cities) return [];
  return Object.keys(doc.cities).sort(trCmp);
}

// — Hub listesi (havalimanı/tren/otobüs seçimi)
export function listHubsForCity({ countryCode, cityName, mode /* 'airport'|'train'|'bus' */ }) {
  const cc = String(countryCode||'').toUpperCase();
  const key = UI2DATA[mode] || mode; // 'plane'|'train'|'bus'
  const doc = HUBS_BY_COUNTRY[cc];
  if (!doc || !key) return [];

  // TR gibi ülkelerde: kullanıcı "Ankara" (il) seçtiyse o ilin altındaki TÜM ilçelerin hub’larını birleştir
  if (CITY_FROM_STATES.has(cc) && Array.isArray(doc.states) && doc.stateCitiesMap) {
    // stateName eşleştir
    const want = norm(cityName);
    const stateName = doc.states.find(s => norm(s) === want) 
                   || doc.states.find(s => norm(s).startsWith(want));
    if (stateName) {
      const cityList = doc.stateCitiesMap[stateName] || [];
      const merged = [];
      for (const cName of cityList) {
        const hubs = safeCityFetch(doc, cName, key);
        if (hubs.length) merged.push(...hubs);
      }
      // isim sıralı ve coordinate valid
      return dedupeAndSort(merged);
    }
  }

  // Normal akış: doğrudan city key
  const arr = safeCityFetch(doc, cityName, key);
  return dedupeAndSort(arr);
}

function safeCityFetch(doc, cityName, key){
  if (!doc?.cities) return [];
  const names = Object.keys(doc.cities);
  const want = norm(cityName);
  const exact = names.find(n => norm(n) === want);
  const cityKey = exact ?? names.find(n => norm(n).startsWith(want));
  if (!cityKey) return [];
  return (doc.cities[cityKey]?.[key] || []).filter(
    h => Number.isFinite(Number(h.lat)) && Number.isFinite(Number(h.lng)) && h?.name
  );
}

function dedupeAndSort(arr){
  const seen = new Set();
  const out = [];
  for (const h of arr) {
    const k = `${norm(h.name)}|${Math.round(h.lat*1e6)}|${Math.round(h.lng*1e6)}`;
    if (!seen.has(k)) { seen.add(k); out.push(h); }
  }
  return out.sort((a,b)=> trCmp(a.name, b.name));
}
