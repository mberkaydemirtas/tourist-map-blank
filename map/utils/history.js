// src/utils/history.js
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Uygulama genelinde kullanılacak standart anahtarlar
 */
export const HISTORY_KEYS = {
  LABEL: {
    ALL: 'search_history',
    FROM: 'search_history_from',
    TO: 'search_history_to',
  },
  PLACE: {
    ROUTE_STOP: 'route_stop_history',
    FAVORITES: 'favorite_places',
    FAVORITES_FROM: 'favorite_places_from',
    FAVORITES_TO: 'favorite_places_to',
    ROUTE_STOP_FAVORITES: 'route_stop_favorites',
  },
};

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                        */
/* ------------------------------------------------------------------ */

const keyOfPlace = (x) =>
  x?.place_id ||
  (Number.isFinite(x?.lat) && Number.isFinite(x?.lng)
    ? `${Math.round(x.lat * 1e6)},${Math.round(x.lng * 1e6)}`
    : null);

const safeParse = (raw, fallback) => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
};

/* ------------------------------------------------------------------ */
/* Label history (string listeleri)                                   */
/* ------------------------------------------------------------------ */

/**
 * En yeni öğe başa gelecek şekilde label’ı ekler (unique & maxLen).
 */
async function pushLabel(key, label, maxLen = 20) {
  try {
    const raw = await AsyncStorage.getItem(key);
    const arr = safeParse(raw, []);
    const next = [label, ...arr.filter((x) => x !== label)].slice(0, maxLen);
    await AsyncStorage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    /* swallow */
  }
  return null;
}

async function getLabels(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return safeParse(raw, []);
  } catch {
    return [];
  }
}

/**
 * Eski kodla uyumluluk: eski 'search_history*' anahtarlarına yapılan push’ları
 * yeni sistemdeki sabitlere yönlendirir.
 */
export async function pushLabelHistoryCompat(key, label, maxLen = 20) {
  try {
    switch (key) {
      case 'search_history':
        await History.pushLabel(HISTORY_KEYS.LABEL.ALL, label, maxLen);
        break;
      case 'search_history_from':
        await History.pushLabel(HISTORY_KEYS.LABEL.FROM, label, maxLen);
        break;
      case 'search_history_to':
        await History.pushLabel(HISTORY_KEYS.LABEL.TO, label, maxLen);
        break;
      default:
        // Tanınmayan key için ALL’e düşelim (no-op da yapılabilir)
        await History.pushLabel(HISTORY_KEYS.LABEL.ALL, label, maxLen);
    }
  } catch {
    /* swallow */
  }
}

/* ------------------------------------------------------------------ */
/* Place history (obje listeleri)                                     */
/* ------------------------------------------------------------------ */

function normalizePlace({ lat, lng, name, address, place_id, description }) {
  const n = name ?? description ?? 'Seçilen yer';
  const adr = address ?? description ?? '';
  const pid = place_id ?? null;

  return {
    place_id: pid,
    name: n,
    address: adr,
    lat,
    lng,
    ts: Date.now(),
    description: n || adr,
    structured_formatting: { main_text: n, secondary_text: adr },
    geometry: { location: { lat, lng } },
    coords: { latitude: lat, longitude: lng },
  };
}

/**
 * Obje listesinde (place) upsert: aynı id/koordinatlı mevcut kaydı çıkarıp
 * en başa ekler; maxLen’e kırpar.
 */
async function upsertPlace(key, place, maxLen = 30) {
  try {
    const raw = await AsyncStorage.getItem(key);
    const arr = safeParse(raw, []);
    const item = normalizePlace(place);
    const idNew = keyOfPlace(item);
    const filtered = arr.filter((x) => keyOfPlace(x) !== idNew);
    const next = [item, ...filtered].slice(0, maxLen);
    await AsyncStorage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    /* swallow */
  }
  return null;
}

async function getPlaces(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return safeParse(raw, []);
  } catch {
    return [];
  }
}

/**
 * Aynı place’i verilen birden çok anahtara paralel olarak kaydeder.
 */
async function savePlaceToMany(keys, place) {
  const item = normalizePlace(place);
  await Promise.all(keys.map((k) => upsertPlace(k, item).catch(() => {})));
}

/* ------------------------------------------------------------------ */
/* Temizleme / Migrasyon                                              */
/* ------------------------------------------------------------------ */

async function clear(key) {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* swallow */
  }
}

/**
 * Migrasyon: karışmış label listelerini normalize eder,
 * place listelerinde temel doğrulama yapar.
 * İdempotent – birden çok kez çağrılabilir.
 */
async function migrate() {
  const labelKeys = Object.values(HISTORY_KEYS.LABEL);
  const placeKeys = Object.values(HISTORY_KEYS.PLACE);

  try {
    // Label listelerini string’e normalize et
    for (const k of labelKeys) {
      const raw = await AsyncStorage.getItem(k);
      if (!raw) continue;
      const arr = safeParse(raw, []);
      const next = arr
        .map((x) =>
          typeof x === 'string'
            ? x
            : x?.description || x?.name || x?.address || ''
        )
        .filter(Boolean);
      await AsyncStorage.setItem(k, JSON.stringify(next));
    }

    // Place listelerinde geçersiz kayıtları ele
    for (const k of placeKeys) {
      const raw = await AsyncStorage.getItem(k);
      if (!raw) continue;
      const arr = safeParse(raw, []);
      const next = arr.filter(
        (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)
      );
      if (next.length !== arr.length) {
        await AsyncStorage.setItem(k, JSON.stringify(next));
      }
    }
  } catch (e) {
    console.warn('history.migrate error', e);
  }
}

/* ------------------------------------------------------------------ */
/* Dışa aktarımlar                                                    */
/* ------------------------------------------------------------------ */

export const History = {
  // labels
  pushLabel,
  getLabels,

  // places
  upsertPlace,
  getPlaces,
  savePlaceToMany,

  // maintenance
  clear,
  migrate,

  // geriye dönük uyumluluk (eski kod History.migrateLegacy() çağırıyordu)
  migrateLegacy: migrate,
};
