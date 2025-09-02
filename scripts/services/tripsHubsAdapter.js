// src/services/tripsHubsAdapter.js
// Basit adaptör: ülke → şehir → (airport/train/bus) listesi.
// Çıktı (Trips için): [{ name, place_id, location:{lat,lng} }, ...]
// Kaynak önceliği:
//   1) data/transport-hubs/index.js  -> export const HUBS_BY_COUNTRY = { TR: {...}, US: {...}, ... }
//   2) data/transport-hubs/all-hubs.json
//   3) Aksi halde null (dinamik import/templateli require KULLANILMIYOR)

let _all = null;                   // all-hubs.json cache
let _hubsIndex = null;             // index.js (HUBS_BY_COUNTRY) cache
const _countryCache = new Map();   // per-country JSON cache

// UI tarafı 'airport'|'train'|'bus' kullanır → veri tarafında 'plane'|'train'|'bus'
const UI2DATA = { airport: 'plane', train: 'train', bus: 'bus' };

/* -------------------------------- helpers ------------------------------- */

function normalize(s) {
  try {
    return String(s || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  } catch {
    return String(s || '').toLowerCase().trim();
  }
}

function safeLocaleCmp(a, b) {
  try {
    return String(a || '').localeCompare(String(b || ''), 'tr', { sensitivity: 'base' });
  } catch {
    return String(a || '').localeCompare(String(b || ''));
  }
}

/* ------------------------------- loaders -------------------------------- */

// Statik require: index.js (opsiyonel)
function loadIndexOnce() {
  if (_hubsIndex !== null) return _hubsIndex;
  try {
    // data/transport-hubs/index.js şu formatta olmalı:
    //   import TR from './TR.json'; ...
    //   export const HUBS_BY_COUNTRY = { TR, ... };
    const mod = require('../../data/transport-hubs');
    _hubsIndex = mod?.HUBS_BY_COUNTRY ?? mod?.default ?? null;
  } catch {
    _hubsIndex = null;
  }
  return _hubsIndex;
}

// Statik require: all-hubs.json (opsiyonel)
function loadAllOnce() {
  if (_all !== null) return _all;
  try {
    // Varsa tek büyük JSON:
    // {
    //   "countries": {
    //     "TR": { "cities": { "Ankara": { "plane": [...], "train": [...], "bus": [...] }, ... } },
    //     ...
    //   }
    // }
    const mod = require('../../data/transport-hubs/all-hubs.json');
    _all = mod?.default ?? mod ?? null;
  } catch {
    _all = null;
  }
  return _all;
}

// Ülke dokümanı döndürür (index.js > all-hubs.json)
function loadCountrySync(code) {
  const cc = String(code || '').toUpperCase();
  if (_countryCache.has(cc)) return _countryCache.get(cc);

  const hubsIndex = loadIndexOnce();
  if (hubsIndex && hubsIndex[cc]) {
    const doc = hubsIndex[cc];
    _countryCache.set(cc, doc);
    return doc;
  }

  const all = loadAllOnce();
  if (all?.countries?.[cc]) {
    const doc = all.countries[cc];
    _countryCache.set(cc, doc);
    return doc;
  }

  _countryCache.set(cc, null);
  return null;
}

/* ------------------------------- mappers -------------------------------- */

function pickCityDoc(countryDoc, cityName) {
  if (!countryDoc?.cities) return null;
  const keys = Object.keys(countryDoc.cities);
  if (!keys.length) return null;

  const want = normalize(cityName);
  const exact = keys.find((k) => normalize(k) === want);
  const key = exact ?? keys.find((k) => normalize(k).startsWith(want)) ?? null;

  return key ? { key, value: countryDoc.cities[key] } : null;
}

function toTripsItem(h) {
  const pid = h.code || h.name || `${h.lat},${h.lng}`;
  return {
    name: h.name,
    place_id: String(pid),
    location: { lat: Number(h.lat), lng: Number(h.lng) },
  };
}

/* ---------------------------------- API --------------------------------- */

// Trips: listHubsForCity({ countryCode, cityName, mode:'airport'|'train'|'bus' })
export async function listHubsForCity({ countryCode, cityName, mode }) {
  const cc = String(countryCode || '').toUpperCase();
  const typeKey = UI2DATA[mode] ?? mode;
  if (!cc || !cityName || !typeKey) return [];

  const countryDoc = loadCountrySync(cc);
  if (!countryDoc) return [];

  const hit = pickCityDoc(countryDoc, cityName);
  if (!hit) return [];

  const arr = (hit.value?.[typeKey] || []).filter(
    (x) => Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng)) && x?.name
  );

  arr.sort((a, b) => safeLocaleCmp(a?.name, b?.name));
  return arr.map(toTripsItem);
}

// Yalnız isim listesi
export async function listHubNames(countryCode, cityName, uiMode) {
  const list = await listHubsForCity({ countryCode, cityName, mode: uiMode });
  return list.map((x) => x.name);
}

// İsim → koordinat
export async function resolveHubByName(countryCode, cityName, uiMode, displayName) {
  const list = await listHubsForCity({ countryCode, cityName, mode: uiMode });
  let hit = list.find((x) => x.name === displayName);
  if (!hit) {
    const target = normalize(displayName);
    hit = list.find((x) => normalize(x.name) === target) || null;
  }
  return hit || null;
}

// Ham gruplar (plane/train/bus)
export async function getCityHubs(countryCode, cityName) {
  const cc = String(countryCode || '').toUpperCase();
  const countryDoc = loadCountrySync(cc);
  const city = pickCityDoc(countryDoc, cityName);
  return city?.value ?? { plane: [], train: [], bus: [] };
}
