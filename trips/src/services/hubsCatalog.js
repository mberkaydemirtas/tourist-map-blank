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

// TR fold + basic normalize (JSC-dostu)
const trFold = (s) =>
  String(s ?? '').replace(
    /[İIıŞşĞğÜüÖöÇçŁłĄąĆćĘęŃńÓóŚśŹźŻż]/g,
    (ch) =>
      ({
        İ: 'i',
        I: 'i',
        ı: 'i',
        Ş: 's',
        ş: 's',
        Ğ: 'g',
        ğ: 'g',
        Ü: 'u',
        ü: 'u',
        Ö: 'o',
        ö: 'o',
        Ç: 'c',
        ç: 'c',
        Ł: 'l',
        ł: 'l',
        Ą: 'a',
        ą: 'a',
        Ć: 'c',
        ć: 'c',
        Ę: 'e',
        ę: 'e',
        Ń: 'n',
        ń: 'n',
        Ó: 'o',
        ó: 'o',
        Ś: 's',
        ś: 's',
        Ź: 'z',
        ź: 'z',
        Ż: 'z',
        ż: 'z',
      }[ch] || ch)
  );

const norm = (s) => trFold(s).toLowerCase().replace(/\s+/g, ' ').trim();
const safeCmp = (a, b) => {
  const A = norm(a),
    B = norm(b);
  if (A < B) return -1;
  if (A > B) return 1;
  return 0;
};

// 'tr' locale'a güvenmeyelim:
const lowerTR = (v) => norm(v);

/** Her koşulda aynı şekil: {plane:[], train:[], bus:[]} */
function normalizeHubsShape(any) {
  try {
    const safeArr = (a) => (Array.isArray(a) ? a : []);
    const obj = any && typeof any === 'object' ? any : {};
    return {
      plane: safeArr(obj.plane),
      train: safeArr(obj.train),
      bus: safeArr(obj.bus),
    };
  } catch {
    return { plane: [], train: [], bus: [] };
  }
}

/* ------------------------------ Mode detect ------------------------------ */

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

/* ------------------------------ City aliases (PL) ------------------------------ */
/**
 * Şehir adı UI'dan "Warsaw" / "Varşova" / "warsaw" gelebilir.
 * City atlas'taki key genelde yerel yazım "Warszawa".
 * Burada sadece PL için yaygın eşleştirmeler ekledik.
 */
const PL_CITY_ALIASES = {
  warsaw: 'Warszawa',
  'varşova': 'Warszawa',
  varsova: 'Warszawa',
  krakow: 'Kraków',
  cracow: 'Kraków',
  lodz: 'Łódź',
  wroclaw: 'Wrocław',
  poznan: 'Poznań',
  gdansk: 'Gdańsk',
  szczecin: 'Szczecin',
  bydgoszcz: 'Bydgoszcz',
  lublin: 'Lublin',
  katowice: 'Katowice',
  bialystok: 'Białystok',
  gdynia: 'Gdynia',
};

function applyCityAlias(cc, city) {
  const CC = String(cc || '').toUpperCase();
  const raw = String(city ?? '').trim();
  if (!raw) return null;

  if (CC === 'PL') {
    const key = norm(raw); // normalize edilmiş lookup
    if (PL_CITY_ALIASES[key]) return PL_CITY_ALIASES[key];
  }

  // default: orijinali döndür (KEY BOZMAYALIM)
  return raw;
}

/* ------------------------------ Lists ------------------------------ */

export function listCountries() {
  let admin = [];
  let city = [];
  try {
    admin = listCountriesAdminLevel() || [];
  } catch {}
  try {
    city = cityAtlasAvailable() ? listCountriesCityLevel() || [] : [];
  } catch {}

  const seen = new Set(admin.map((x) => x.code));
  const merged = admin.concat(city.filter((x) => !seen.has(x.code)));
  merged.sort((a, b) => safeCmp(a?.name, b?.name));
  return merged;
}

export function getCountryMode(cc) {
  return detectModeForCountry(cc);
}

export function listAdmins(cc) {
  try {
    return detectModeForCountry(cc) === 'admin' ? listAdminsState(cc) || [] : [];
  } catch {
    return [];
  }
}

export function listCities(cc) {
  try {
    if (detectModeForCountry(cc) !== 'city') return [];
    const arr = listCitiesCity(cc) || [];
    return arr.map((x) => x?.name).filter(Boolean);
  } catch {
    return [];
  }
}

export function listStatesInCityAtlas(cc) {
  try {
    return detectModeForCountry(cc) === 'city' ? listStatesCity(cc) || [] : [];
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
    try {
      console.log(
        '[getHubs]',
        'mode=' + mode,
        'country=' + CC,
        'admin=' + lowerTR(admin),
        'city_raw=' + String(city ?? ''),
        'city_norm=' + norm(city)
      );
    } catch {}
  }

  // --- ADMIN MODE (TR gibi) ---
  if (mode === 'admin') {
    const key = lowerTR(admin);
    if (!key) return normalizeHubsShape(null);

    try {
      const out = getHubsForAdmin(CC, key);
      if (__DEV__)
        try {
          console.log(
            '[getHubs] admin result',
            'plane=' + (out?.plane?.length || 0),
            'train=' + (out?.train?.length || 0),
            'bus=' + (out?.bus?.length || 0)
          );
        } catch {}
      return normalizeHubsShape(out);
    } catch (e) {
      try {
        console.error('[getHubsForAdmin] error:', e?.message || e);
      } catch {}
      return normalizeHubsShape(null);
    }
  }

  // --- CITY MODE (PL gibi) ---
  // ❗Burada LOWERCASE yapmıyoruz; çünkü JSON key'i ile birebir eşleşme gerekir.
  const resolvedCity = applyCityAlias(CC, city);
  if (!resolvedCity) return normalizeHubsShape(null);

  try {
    const out = getHubsForCity(CC, resolvedCity);

    if (__DEV__)
      try {
        console.log(
          '[getHubs] city resolved',
          'city=' + resolvedCity,
          'plane=' + (out?.plane?.length || 0),
          'train=' + (out?.train?.length || 0),
          'bus=' + (out?.bus?.length || 0)
        );
      } catch {}

    return normalizeHubsShape(out);
  } catch (e) {
    try {
      console.error('[getHubsForCity] error:', e?.message || e);
    } catch {}
    return normalizeHubsShape(null);
  }
}
