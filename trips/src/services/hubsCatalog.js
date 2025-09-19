// trips/trips/src/services/hubsCatalog.js
import {
  listCountriesAdminLevel,
  listAdmins as listAdminsState,
  getHubsForAdmin,
  getCountryDoc as getCountryDocState,
} from './atlasStateAdapter';

import {
  isAvailable as cityAtlasAvailable,
  listCountriesCityLevel,
  listStates as listStatesCity,
  listCities as listCitiesCity,
  getHubsForCity,
  getCountryDoc as getCountryDocCity,
} from './atlasCityAdapter';

/* ------------------------------ Helpers ------------------------------ */

const trFold = (s) => String(s ?? '').replace(
  /[İIıŞşĞğÜüÖöÇç]/g,
  (ch) => ({'İ':'i','I':'i','ı':'i','Ş':'s','ş':'s','Ğ':'g','ğ':'g','Ü':'u','ü':'u','Ö':'o','ö':'o','Ç':'c','ç':'c'}[ch] || ch)
);
const norm = (s) => trFold(s).toLowerCase().replace(/\s+/g, ' ').trim();
const safeCmp = (a, b) => {
  const A = norm(a), B = norm(b);
  if (A < B) return -1; if (A > B) return 1; return 0;
};
// 'tr' locale'a güvenmeyelim:
const lowerTR = (v) => norm(v);

/** Her koşulda aynı şekil: {plane:[], train:[], bus:[]} */
function normalizeHubsShape(any) {
   try {
     const safeArr = (a) => (Array.isArray(a) ? a : []);
     const obj = (any && typeof any === 'object') ? any : {};
     return {
       plane: safeArr(obj.plane),
       train: safeArr(obj.train),
       bus:   safeArr(obj.bus),
     };
   } catch {
     return { plane: [], train: [], bus: [] };
   }
}

function detectModeForCountry(cc) {
  const CC = String(cc || '').toUpperCase();
  // TR zorunlu admin
  if (CC === 'TR') return 'admin';
  try {
    const sDoc = getCountryDocState(CC);
    if (sDoc?.level === 'admin') return 'admin';
  } catch {}
  try {
    const cDoc = getCountryDocCity(CC);
    if (cDoc?.cities) return 'city';
  } catch {}
  return 'admin';
}

/* ------------------------------ Lists ------------------------------ */

export function listCountries() {
  let admin = [];
  let city = [];
  try { admin = listCountriesAdminLevel() || []; } catch {}
  try { city = cityAtlasAvailable() ? (listCountriesCityLevel() || []) : []; } catch {}

  const seen = new Set(admin.map(x => x.code));
  const merged = admin.concat(city.filter(x => !seen.has(x.code)));
  merged.sort((a, b) => safeCmp(a?.name, b?.name));
  return merged;
}

export function getCountryMode(cc) {
  return detectModeForCountry(cc);
}

export function listAdmins(cc) {
  try {
    return detectModeForCountry(cc) === 'admin' ? (listAdminsState(cc) || []) : [];
  } catch {
    return [];
  }
}

export function listCities(cc) {
  try {
    if (detectModeForCountry(cc) !== 'city') return [];
    const arr = listCitiesCity(cc) || [];
    return arr.map(x => x?.name).filter(Boolean);
  } catch {
    return [];
  }
}

export function listStatesInCityAtlas(cc) {
  try {
    return detectModeForCountry(cc) === 'city' ? (listStatesCity(cc) || []) : [];
  } catch {
    return [];
  }
}

/* ------------------------------ Main API ------------------------------ */
/** StartEndQuestion için tek giriş */
export function getHubs({ country, admin, city }) {
  const CC = String(country || '').toUpperCase();
  const mode = detectModeForCountry(CC);



  // Debug logları format specifier’sız (JSC’de daha stabil)
   if (__DEV__) {
     try { console.log('[getHubs]', 'mode='+mode, 'country='+CC, 'admin='+norm(admin), 'city='+norm(city)); } catch {}
   }
  // TR => admin modu, diğer ülkelerde detectModeForCountry sonucu
  if (mode === 'admin') {
    const key = lowerTR(admin);
    if (!key) return normalizeHubsShape(null);

    try {
      const out = getHubsForAdmin(CC, key);
       if (__DEV__) try {
         console.log('[getHubs] admin result',
           'plane='+(out?.plane?.length||0),
           'train='+(out?.train?.length||0),
           'bus='+(out?.bus?.length||0));
       } catch {}
      return normalizeHubsShape(out);
    } catch (e) {
      try { console.error('[getHubsForAdmin] error:', e?.message || e); } catch {}
      return normalizeHubsShape(null);
    }
  }

  // city modu
  const key = lowerTR(city);
  if (!key) return normalizeHubsShape(null);

  try {
    const out = getHubsForCity(CC, key);
     if (__DEV__) try {
       console.log('[getHubs] city result',
         'plane='+(out?.plane?.length||0),
         'train='+(out?.train?.length||0),
         'bus='+(out?.bus?.length||0));
     } catch {}
    return normalizeHubsShape(out);
  } catch (e) {
    try { console.error('[getHubsForCity] error:', e?.message || e); } catch {}
    return normalizeHubsShape(null);
  }
}
