// /trips/screens/TripPlanHelpers
import { Platform, UIManager } from 'react-native';
import Constants from 'expo-constants';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* -------------------- SABİTLER -------------------- */

// TripPlansScreen'den taşınan global sabitler
export const uid = () => `d_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

export const DIRECTIONS_API_KEY =
  Constants?.expoConfig?.extra?.GOOGLE_MAPS_API_KEY ||
  Constants?.manifest?.extra?.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  global?.GOOGLE_MAPS_API_KEY ||
  '';

// toLatLng ve round5k dışarıda tanımlanmış, onları da buraya taşıyalım.
export const toLatLng = (p={}) => ({
  lat:  p.lat ?? p.latitude,
  lng:  p.lng ?? p.lon ?? p.longitude,
});
export const round5k = (x) => Math.round(Number(x) * 1e5) / 1e5;

export const keyOf = (x) => {
  const lat = Number(x?.lat ?? x?.coords?.lat);
  const lon = Number(x?.lon ?? x?.coords?.lng ?? x?.coords?.lon);
  const nm  = String(x?.name || '').trim().toLowerCase();
  return `${nm}@${round5k(lat)},${round5k(lon)}`;
};

/* -------------------- YARDIMCI FONKSİYONLAR -------------------- */

export function boundsToRegion(ne, sw) {
  const latDelta = Math.max(0.005, Math.abs(ne.lat - sw.lat) * 1.2);
  const lngDelta = Math.max(0.005, Math.abs(ne.lng - sw.lng) * 1.2);
  return {
    latitude: (ne.lat + sw.lat) / 2,
    longitude: (ne.lng + sw.lng) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

export const sanitizeIsoDate = (d) => {
  if (!d || typeof d !== 'string') return null;
  const m = d.match(/^(\d{4,5})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  let [_, y, mo, da] = m;
  if (y.length === 5 && y.startsWith('200')) y = '20' + y.slice(3); // 20025 -> 2025
  const yr = +y, mm = +mo, dd = +da;
  if (!(yr>=1900 && yr<=2100)) return null;
  if (!(mm>=1 && mm<=12)) return null;
  if (!(dd>=1 && dd<=31)) return null;
  return `${String(yr).padStart(4,'0')}-${mo}-${da}`;
};
export const addDaysISO = (iso, n) => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
};
export const nightsBetween = (start, end) => {
  const out=[]; if(!start||!end||start>=end) return out;
  let cur=start; while(cur<end){ out.push(cur); cur=addDaysISO(cur,1); } return out;
};
export const deriveDateRange = (trip) => {
  const dr = trip?.dateRange || {};
  let start = sanitizeIsoDate(dr.start);
  let end  = sanitizeIsoDate(dr.end);
  if ((!start || !end) && trip?._startEndSingle) {
    start = sanitizeIsoDate(trip._startEndSingle.start?.date) || start;
    end  = sanitizeIsoDate(trip._startEndSingle.end?.date)  || end;
  }
  return { start, end };
};
/** TripReview’ün yazdığı düz listeyi (trip.lodgings) güne bağlar.
 * Eksikse _lodgingSingle’den full cover üretir. */
export const mapLodgingsByDateWithFallback = (trip) => {
  const { start, end } = deriveDateRange(trip);
  const nights = nightsBetween(start, end);
  const byDate = Object.create(null);
  // 1) düz liste
  for (const it of (trip?.lodgings || [])) {
    const d = sanitizeIsoDate(it?.date);
    const loc = it?.location;
    if (!d || !loc) continue;
    byDate[d] = {
      name: it?.name || 'Lodging',
      lat:  Number(loc.lat),
      lon:  Number(loc.lon ?? loc.lng),
    };
  }
  // 2) fallback
  const seg = (trip?._lodgingSingle || [])[0];
  const segLoc = seg?.place?.location || seg?.place?.place?.location || null;
  const segName = seg?.place?.name || seg?.place?.place?.name || null;
  if (segLoc) {
    for (const d of nights) {
      if (!byDate[d]) {
        byDate[d] = {
          name: segName || 'Lodging',
          lat: Number(segLoc.lat),
          lon: Number(segLoc.lon ?? segLoc.lng),
        };
      }
    }
  }
  const lodgingsCount = nights.filter(d => !!byDate[d]).length;
  return { byDate, lodgingsCount, range:{start,end} };
};

export function sameLoc(a, b) {
  if (!a || !b) return false;
  const al = { lat: a.lat ?? a?.place?.location?.lat, lon: a.lon ?? a?.place?.location?.lon };
  const bl = { lat: b.lat ?? b?.place?.location?.lat, lon: b.lon ?? b?.place?.location?.lon };
  return Number.isFinite(al.lat) && Number.isFinite(al.lon) &&
         Number.isFinite(bl.lat) && Number.isFinite(bl.lon) &&
         Math.abs(al.lat - bl.lat) < 1e-5 && Math.abs(al.lon - bl.lon) < 1e-5;
}

export function normalizeISO(d) {
  if (!d) return null;
  try { return new Date(d).toISOString().slice(0,10); } catch { return null; }
}

// wizard segmentlerinden tüm konaklamaları tek listeye çevir
export function collectLodgingsFromTrip(trip) {
  const wa = trip?._whereAnswer;
  const pushSegs = (segments=[]) => {
    const arr = [];
    (segments||[]).forEach((seg, idx) => {
      const loc = seg?.place?.location;
      if (!loc?.lat || (loc.lng==null && loc.lon==null)) return;
      const lat = Number(loc.lat);
      const lon = Number(loc.lng ?? loc.lon);
      for (const d of nightsBetween(seg.start, seg.end)) {
        arr.push({
          id: seg.id || `lodg:${idx}:${d}`,
          name: seg?.place?.name || 'Lodging',
          date: d,
          location: { lat, lon },
          address: seg?.place?.address || null,
        });
      }
    });
    return arr;
  };

  let all = [];
  if (wa?.mode === 'single') {
    all = pushSegs(trip?._lodgingSingle || []);
  } else if (wa) {
    const items = (wa.items || []).filter(it => it.city?.place_id);
    items.forEach(it => {
      const key = it.city.place_id;
      all = all.concat(pushSegs(trip?._lodgingByCity?.[key] || []));
    });
  }
  return all;
}

export function isStrictPlaceId(pid) {
  if (typeof pid !== 'string') return false;
  return /^(ChIJ|Gh)[A-Za-z0-9_-]{8,}$/.test(pid);
}

export function makeEmptyPlan(tripId) {
  const todayISO = new Date().toISOString().slice(0,10);
  return {
    _id: `plan_${tripId}`,
    id: `plan_${tripId}`,
    tripId,
    days: [{ id: uid(), date: todayISO, activities: [] }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'scratch',
  };
}

export function getPlacesArray(trip) {
  return Array.isArray(trip?.places) && trip.places.length
    ? trip.places
    : (Array.isArray(trip?.selectedPlaces) ? trip.selectedPlaces : []);
}
export function cityNameOfTrip(trip) {
  if (Array.isArray(trip?.cities) && trip.cities.length) return trip.cities[0];
  const wa = trip?._whereAnswer;
  if (wa?.mode === 'single') return wa?.single?.city?.name || '';
  return '';
}

/** plan üretiminden önce güvenlik katmanı (resolve & patch) */
import { resolvePlacesBatch } from '../services/placeResolver';
import { patchTripLocal } from '../../app/lib/tripsLocal';

export async function ensureResolvedForPlan(trip) {
  if (!trip) return trip;
  const sourceField =
    Array.isArray(trip?.places) && trip.places.length ? 'places'
    : (Array.isArray(trip?.selectedPlaces) ? 'selectedPlaces' : 'places');

  const all = getPlacesArray(trip);
  if (!all.length) return trip;

  const unresolved = all.filter(p => {
    if (p?.place_id) return false;
    const lat = Number(p?.lat ?? p?.coords?.lat);
    const lon = Number(p?.lon ?? p?.coords?.lng ?? p?.coords?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && (p?.name || '').trim().length > 0;
  });

  if (!unresolved.length) return trip;

  const city = cityNameOfTrip(trip) || '';
  let batch = [];
  try {
    const b = await resolvePlacesBatch({ items: unresolved, city });
    if (Array.isArray(b)) batch = b;
    else if (Array.isArray(b?.items)) batch = b.items;
  } catch { return trip; }

  const byKey = new Map(batch.map(x => [keyOf(x), x]));
  let changed = false;

  const merged = all.map(old => {
    if (old?.place_id) return old;
    const nn = byKey.get(keyOf(old));
    if (nn?.place_id) {
      const gLat = Number(nn?.coords?.lat ?? nn?.lat);
      const gLon = Number(nn?.coords?.lng ?? nn?.lon);
      const coordsNew = (Number.isFinite(gLat) && Number.isFinite(gLon))
        ? { lat: gLat, lng: gLon }
        : (old.coords || null);

      changed = true;
      return {
        ...old,
        place_id: nn.place_id,
        resolved: true,
        coords: coordsNew || old.coords || null,
        lat: coordsNew?.lat ?? old.lat,
        lon: coordsNew?.lng ?? old.lon,
        opening_hours: nn.opening_hours ?? old.opening_hours ?? null,
        rating: nn.rating ?? old.rating ?? null,
        user_ratings_total: nn.user_ratings_total ?? old.user_ratings_total ?? null,
        price_level: nn.price_level ?? old.price_level ?? null,
        _matched: true,
      };
    }
    return old;
  });

  if (!changed) return trip;

  const key = trip._id ?? trip.id;
  const patched = {
    ...(trip || {}),
    [sourceField]: merged,
    updatedAt: new Date().toISOString(),
    __dirty: true,
  };
  try {
    if (key) await patchTripLocal(key, { [sourceField]: merged, updatedAt: patched.updatedAt, __dirty: true });
  } catch {}
  return patched;
}

/* -------- getPlaceDetails cache + de-dupe -------- */
import { getPlaceDetails } from '../../map/maps';

const detailsCache = new Map();
const inFlightDetails = new Map();

export async function getDetailsWithCache(placeId) {
  if (!isStrictPlaceId(placeId)) return null;

  const cached = detailsCache.get(placeId);
  if (cached && Date.now() - cached.ts < 1000 * 60 * 30) return cached.data;

  if (inFlightDetails.has(placeId)) return inFlightDetails.get(placeId);

  const p = (async () => {
    try {
      const det = await getPlaceDetails(placeId);
      let photos = [];
      if (Array.isArray(det?.photos)) {
        photos = det.photos
          .map((p) => (typeof p === 'string' ? p : (p?.url || p?.uri || p?.photoUrl || p?.src || p?.photo_reference)))
          .filter(Boolean);
      }
      const norm = det ? { coords: det.coords, name: det.name, address: det.address, photos } : null;
      if (norm) detailsCache.set(placeId, { data: norm, ts: Date.now() });
      return norm;
    } catch {
      return null;
    } finally {
      inFlightDetails.delete(placeId);
    }
  })();

  inFlightDetails.set(placeId, p);
  return p;
}

/* 📸 Activity içinden foto toplama */
export function extractPhotoUrlsFromActivity(a) {
  const out = [];
  const pushAny = (v) => {
    if (!v) return;
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'object') {
      if (v.url) out.push(v.url);
      else if (v.uri) out.push(v.uri);
      else if (v.photoUrl) out.push(v.photoUrl);
      else if (v.src) out.push(v.src);
      else if (v.photo_reference) out.push(v.photo_reference);
    }
  };
  if (Array.isArray(a?.place?.photos)) a.place.photos.forEach(pushAny);
  pushAny(a?.place?.coverPhoto);
  pushAny(a?.place?.photoUrl);
  pushAny(a?.meta?.photoUrl);
  pushAny(a?.icon);
  return out.filter(Boolean);
}

/* activity → strict place_id */
export function extractPossiblePlaceIdFromActivity(a) {
  const candidates = [
    a?.place?.place_id,
    a?.meta?.place_id,
    a?.gPlaceId,
    a?.place?.gPlaceId,
    a?.place?.id,
  ].filter(Boolean);
  return candidates.find(isStrictPlaceId) || null;
}

/** Google Places photo_reference -> tam URL */
export function buildGooglePhotoUrl(photoRef, apiKey, { maxwidth = 800 } = {}) {
  if (!photoRef || !apiKey) return null;
  const base = 'https://maps.googleapis.com/maps/api/place/photo';
  const p = new URLSearchParams({ photoreference: String(photoRef), maxwidth: String(maxwidth), key: String(apiKey) });
  return `${base}?${p.toString()}`;
}

/** Karışık girdi -> https URL listesi */
export function coercePhotoInputsToUrls(list, apiKey, { maxwidth = 800 } = {}) {
  const out = [];
  for (const v of list || []) {
    if (!v) continue;
    if (typeof v === 'string') {
      if (/^https?:\/\//i.test(v)) out.push(v);
      else if (/^[A-Za-z0-9_-]{20,}$/.test(v)) {
        const u = buildGooglePhotoUrl(v, apiKey, { maxwidth });
        if (u) out.push(u);
      } else if (/place\/photo/i.test(v) && !/(\?|&)key=/.test(v) && apiKey) {
        const sep = v.includes('?') ? '&' : '?';
        out.push(`${v}${sep}key=${apiKey}`);
      }
    } else if (typeof v === 'object') {
      const url = v.url || v.uri || v.src || v.photoUrl;
      if (url && /^https?:\/\//i.test(url)) out.push(url);
      else if (v.photo_reference) {
        const u = buildGooglePhotoUrl(v.photo_reference, apiKey, { maxwidth });
        if (u) out.push(u);
      }
    }
  }
  return Array.from(new Set(out));
}

export function uniqHttps(arr) {
  return Array.from(new Set((arr || [])
    .map(String)
    .filter(u => /^https?:\/\//i.test(u))));
}

function _cleanTitle(s) {
  if (!s) return '';
  return String(s)
    .replace(/\s+/g, ' ')       // double space → single
    .replace(/[|•–—\-]+/g, '–')    // farklı ayraçları normalize et
    .replace(/^[\s–,.;:]+|[\s–,.;:]+$/g, '') // baş/son noktalama
    .trim();
}

function _isGenericTitle(s, idx1) {
  if (!s) return true;
  const x = s.toLowerCase();
  // "Durak 3", "Seçilen yer/konum", "Nokta" gibi generikler
  if (/^durak\s*\d+$/i.test(x)) return true;
  if (x === 'durak' || x === 'nokta') return true;
  if (x === 'seçilen yer' || x === 'seçilen konum') return true;
  // "Durak 3 - Durak 3" benzeri aynı ifadenin tekrarı
  if (/^(durak\s*\d+)\s*[–-]\s*\1$/i.test(x)) return true;
  // "Unnamed" varyasyonları
  if (/^isimsiz|^unnamed|^unknown/.test(x)) return true;
  // İçinde sadece rakam/ok işareti olanlar
  if (/^[\d\s→\-–]+$/.test(x)) return true;
  // "Durak idx" ise (idx1 verildiyse)
  if (idx1 && x === `durak ${idx1}`) return true;
  return false;
}

function _shortAddress(addr) {
  const s = _cleanTitle(addr);
  // "Cadde, İlçe, Şehir" → ilk parça
  const first = s.split(',')[0]?.trim();
  return first?.length >= 3 ? first : s || '';
}

function _dedupeSegments(s) {
  // "A – A", "A | A" gibi tekrarları sadele
  const parts = s.split(/[\s–|]+/).filter(Boolean);
  const uniq = [];
  for (const p of parts) {
    if (!uniq.some(u => u.toLowerCase() === p.toLowerCase())) uniq.push(p);
  }
  return uniq.join(' – ');
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    // Eğer string zaten "2025-10-21" formatındaysa ve sadece bunu göstermek istiyorsanız:
    // return dateStr; 

    // Veya Türkçe formatlama ("21 Ekim"):
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // Geçersiz tarihse olduğu gibi döndür
    
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  } catch (e) {
    return dateStr;
  }
}

export function limitPhotos(arr, n = 2) {
  return Array.isArray(arr) ? arr.slice(0, n) : [];
}

export function getActName(a, idx) {
  const idx1 = Number.isFinite(idx) ? idx + 1 : null;
  const candsRaw = [
    a?.place?.name,
    a?.place?.displayName,
    a?.label,
    a?.title,
    a?.place?.formatted_address,
    a?.place?.address,
  ];

  // temizle + boşları at
  const cands = candsRaw.map(_cleanTitle).filter(Boolean);

  // generik olmayan ilk iyi aday
  let best = cands.find(t => !_isGenericTitle(t, idx1));

  // hâlâ yoksa adresi kısaltıp dene
  if (!best) {
    const addr = a?.place?.formatted_address || a?.place?.address || '';
    const short = _shortAddress(addr);
    if (short && !_isGenericTitle(short, idx1)) best = short;
  }

  // olmazsa "Durak N"
  if (!best) best = idx1 ? `Durak ${idx1}` : 'Durak';

  // "Durak 1 – Durak 1" gibi tekrarları temizle
  best = _dedupeSegments(best);

  return best;
}

/** ✅ Çapraz tab → Keşfet tab’ındaki NavigationScreen'e git */
import { Alert, Linking } from 'react-native';

export function navigateToTurnByTurn(navigation, params) {
  try {
    const state = navigation.getState?.();
    const names = (state?.routes || []).map(r => r.name);
    if (names.includes('NavigationScreen')) {
      navigation.navigate('NavigationScreen', params);
      return;
    }
  } catch {}

  let parent = navigation;
  while (parent?.getParent) parent = parent.getParent();
  const rootNav = parent || navigation;

  try {
    rootNav.navigate('Keşfet', { screen: 'NavigationScreen', params });
    return;
  } catch (e) {
    console.warn('[navigateToTurnByTurn] cross-tab navigate hata:', e?.message);
  }

  try {
    let cur = navigation;
    const lines = [];
    while (cur && typeof cur.getState === 'function') {
      const st = cur.getState();
      const names = (st?.routes || []).map(r => r.name);
      lines.push(`• Routes: [${names.join(', ')}], index=${st?.index}`);
      cur = cur.getParent?.();
    }
    console.warn('[Navigator tree]\n' + lines.join('\n'));
  } catch {}
  Alert.alert('Navigasyon', 'NavigationScreen’a giden yolu bulamadım. Tab adı "Keşfet", screen adı "NavigationScreen" olmalı.');
}

export function normalizeDateISO(d) {
  if (!d) return null;
  try { return new Date(d).toISOString().split('T')[0]; } catch { return null; }
}

export function deriveLodgeFromTrip(trip, day) {
  if (!trip || !day) return null;
  const { byDate } = mapLodgingsByDateWithFallback(trip);
  const d = normalizeISO(day.date);
  const hit = byDate[d];
  return hit || null;
}

// String 'YYYY-MM-DD' ise aynen dön; değilse local date'ten YYYY-MM-DD üret
export function toISODateSafe(d) {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return null;
  }
}

/** UI’da göstermek için sentetik anchor-activity (ÖNE ALINDI) */
export function makeAnchorActivity(kind, src, label) {
  if (!src) return null;
  const coords = (src.location && src.location.lat != null)
    ? { lat: src.location.lat, lon: src.location.lon }
    : { lat: src.lat, lon: src.lon };
  if (!coords || coords.lat == null || coords.lon == null) return null;

  const placeName = src.name || src.place?.name || null;
  const displayName = (kind === 'lodging')
    ? (placeName ? `${label} • ${placeName}` : label)
    : (label || (kind === 'start' ? 'Başlangıç' : kind === 'end' ? 'Bitiş' : 'Nokta'));

  const id = `anchor:${kind}:${displayName}:${coords.lat},${coords.lon}`;
  return {
    id,
    type: 'anchor',
    durationMin: 0,
    start: null,
    end: null,
    place: {
      id,
      name: displayName,
      location: { lat: coords.lat, lon: coords.lon },
      category: kind, // 'start' | 'lodging' | 'end'
      address: src.address || '',
      photos: [],
    },
    meta: { category: kind, isAnchor: true },
  };
}

/** UI listesi (aktif gün için ham üretim) — start/end/lodging dahil (ÖNE ALINDI) */
export const uiActivitiesRawFn = (tripObj, dayObj, anchors) => {
  if (!dayObj) return [];
  const { start, end, lodge, startLabel, endLabel } = anchors || {};

  const startA  = start   ? makeAnchorActivity('start',   start,   startLabel) : null;
  const endA    = end     ? makeAnchorActivity('end',     end,     endLabel)   : null;
  let  lodgingA = lodge   ? makeAnchorActivity('lodging', lodge,   'Konaklama') : null;

  // Çakışanları sadeleştir
  if (lodgingA && startA && sameLoc(lodgingA.place.location, startA.place.location)) lodgingA = null;
  if (lodgingA && endA    && sameLoc(lodgingA.place.location, endA.place.location))    lodgingA = null;

  const onlyAnchors = !Array.isArray(dayObj.activities) || dayObj.activities.length === 0;
  const startEndSame = startA && endA && sameLoc(startA.place.location, endA.place.location);
  const tail = (startEndSame && onlyAnchors) ? [] : [endA];

  return [startA, ...(dayObj.activities || []), lodgingA, ...tail].filter(Boolean);
};

export function mapLodgingsByDate(trip) {
  return mapLodgingsByDateWithFallback(trip);
}

export function startEndForDay(tripObj, dday) {
  const se = tripObj?._startEndSingle || {};

  const _sanDate = (s) => {
    if (!s || typeof s !== 'string') return s;
    const m = s.match(/^(\d{4,5})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    let [_, y, mo, da] = m;
    if (y.length === 5 && y.startsWith('200')) y = '20' + y.slice(3);
    return `${y}-${mo}-${da}`;
  };

  const sDate = _sanDate(se?.start?.date);
  const eDate = _sanDate(se?.end?.date);
  const dayISO = toISODateSafe(dday?.date);

  const isStartDay = !!(sDate && dayISO && sDate === dayISO);
  const isEndDay   = !!(eDate && dayISO && eDate === dayISO);

  const startHub = isStartDay && se?.start?.hub?.location
    ? { lat: se.start.hub.location.lat, lon: (se.start.hub.location.lon ?? se.start.hub.location.lng) }
    : null;
  const endHub = isEndDay && se?.end?.hub?.location
    ? { lat: se.end.hub.location.lat,  lon: (se.end.hub.location.lon ?? se.end.hub.location.lng) }
    : null;

  const start = startHub || null;
  const end   = endHub   || null;
  return { start, end };
}