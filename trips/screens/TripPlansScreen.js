// trips/screens/TripPlansScreen.js
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, Dimensions, ActivityIndicator, Alert,
   BackHandler, LayoutAnimation, Platform, UIManager, ScrollView, TouchableOpacity, Linking
 } from 'react-native';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

// Bileşenleri ve servisleri import et
import SideTimeline from '../components/SideTimeline';
import PlaceQuickCard from '../../map/components/PlaceQuickCard';
import TripRouteSheet from '../components/TripRouteSheet';
import PermissionPromptModal from '../../map/components/PermissionPromptModal';

import { getRouteDirections } from '../services/RouteDirectionService';
import { generatePlan } from '../services/planService';
import { getTripLocal, patchTripLocal } from '../../app/lib/tripsLocal';
import { getPlanByTripId, savePlan } from '../shared/plansRepo';
import { formatDate } from '../shared/types';
import { resolvePlacesBatch } from '../services/placeResolver';
import { getPlaceDetails } from '../../map/maps';
import { optimizeDayWithAnchors } from '../services/dayOptimizer';
import { getAnchorsForDayDetailed } from '../shared/anchors';
import { autocomplete } from '../../map/maps';
import { Modal } from 'react-native';
import { Calendar } from 'react-native-calendars';

const { width: SCREEN_W } = Dimensions.get('window');

const COLORS = {
  bgApp: '#F3F4F6',
  bgCard: '#FFFFFF',
  border: '#E5E7EB',
  fg: '#111827',
  fgMuted: '#6B7280',
  primary: '#111827',
  accent: '#2563EB',
  accentDim: '#EFF6FF',
  warnSoftBg: '#FFF6ED',
  warnSoftBorder: '#FBD6B6',
  success: '#4CAF50',
  neutral: '#607D8B',
};
const toLatLng = (p={}) => ({
  lat:  p.lat ?? p.latitude,
  lng:  p.lng ?? p.lon ?? p.longitude,
});
const LEFT_OPEN_W = Math.min(380, SCREEN_W * 0.42);
const LEFT_CLOSED_W = 0;
const TOGGLE_PEEK = 12;
const TOGGLE_SIZE = 44;
const uid = () => `d_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ---------- helpers ---------- */
const sanitizeIsoDate = (d) => {
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
const addDaysISO = (iso, n) => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
};
const nightsBetween = (start, end) => {
  const out=[]; if(!start||!end||start>=end) return out;
  let cur=start; while(cur<end){ out.push(cur); cur=addDaysISO(cur,1); } return out;
};
const deriveDateRange = (trip) => {
  const dr = trip?.dateRange || {};
  let start = sanitizeIsoDate(dr.start);
  let end   = sanitizeIsoDate(dr.end);
  if ((!start || !end) && trip?._startEndSingle) {
    start = sanitizeIsoDate(trip._startEndSingle.start?.date) || start;
    end   = sanitizeIsoDate(trip._startEndSingle.end?.date)   || end;
  }
  return { start, end };
};
/** TripReview’ün yazdığı düz listeyi (trip.lodgings) güne bağlar.
 *  Eksikse _lodgingSingle’den full cover üretir. */
const mapLodgingsByDateWithFallback = (trip) => {
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

function sameLoc(a, b) {
  if (!a || !b) return false;
  const al = { lat: a.lat ?? a?.place?.location?.lat, lon: a.lon ?? a?.place?.location?.lon };
  const bl = { lat: b.lat ?? b?.place?.location?.lat, lon: b.lon ?? b?.place?.location?.lon };
  return Number.isFinite(al.lat) && Number.isFinite(al.lon) &&
         Number.isFinite(bl.lat) && Number.isFinite(bl.lon) &&
         Math.abs(al.lat - bl.lat) < 1e-5 && Math.abs(al.lon - bl.lon) < 1e-5;
}

function normalizeISO(d) {
  if (!d) return null;
  try { return new Date(d).toISOString().slice(0,10); } catch { return null; }
}

// wizard segmentlerinden tüm konaklamaları tek listeye çevir
function collectLodgingsFromTrip(trip) {
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

const round5k = (x) => Math.round(Number(x) * 1e5) / 1e5;
const keyOf = (x) => {
  const lat = Number(x?.lat ?? x?.coords?.lat);
  const lon = Number(x?.lon ?? x?.coords?.lng ?? x?.coords?.lon);
  const nm  = String(x?.name || '').trim().toLowerCase();
  return `${nm}@${round5k(lat)},${round5k(lon)}`;
};

function isStrictPlaceId(pid) {
  if (typeof pid !== 'string') return false;
  return /^(ChIJ|Gh)[A-Za-z0-9_-]{8,}$/.test(pid);
}

function makeEmptyPlan(tripId) {
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

function getPlacesArray(trip) {
  return Array.isArray(trip?.places) && trip.places.length
    ? trip.places
    : (Array.isArray(trip?.selectedPlaces) ? trip.selectedPlaces : []);
}
function cityNameOfTrip(trip) {
  if (Array.isArray(trip?.cities) && trip.cities.length) return trip.cities[0];
  const wa = trip?._whereAnswer;
  if (wa?.mode === 'single') return wa?.single?.city?.name || '';
  return '';
}

/** plan üretiminden önce güvenlik katmanı (resolve & patch) */
async function ensureResolvedForPlan(trip) {
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
const detailsCache = new Map();
const inFlightDetails = new Map();

async function getDetailsWithCache(placeId) {
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
function extractPhotoUrlsFromActivity(a) {
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
function extractPossiblePlaceIdFromActivity(a) {
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
function buildGooglePhotoUrl(photoRef, apiKey, { maxwidth = 800 } = {}) {
  if (!photoRef || !apiKey) return null;
  const base = 'https://maps.googleapis.com/maps/api/place/photo';
  const p = new URLSearchParams({ photoreference: String(photoRef), maxwidth: String(maxwidth), key: String(apiKey) });
  return `${base}?${p.toString()}`;
}

/** Karışık girdi -> https URL listesi */
function coercePhotoInputsToUrls(list, apiKey, { maxwidth = 800 } = {}) {
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

function uniqHttps(arr) {
  return Array.from(new Set((arr || [])
    .map(String)
    .filter(u => /^https?:\/\//i.test(u))));
}

/* ---- Marker child (memo) ---- */
const NumMarker = React.memo(function NumMarker({ bg, order }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <View style={[styles.numMarkerInner, { backgroundColor: bg }]}>
        <Text style={styles.numMarkerText}>{order}</Text>
      </View>
      <View style={[styles.numMarkerTip, { borderTopColor: bg }]} />
    </View>
  );
});

/* ---- UI helpers ---- */
function getActName(a, idx) {
  return (
    a?.place?.name ||
    a?.place?.displayName ||
    a?.label ||
    a?.title ||
    a?.place?.formatted_address ||
    `Durak ${idx + 1}`
  );
}

/** ✅ Çapraz tab → Keşfet tab’ındaki NavigationScreen'e git */
function navigateToTurnByTurn(navigation, params) {
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

function normalizeDateISO(d) {
  if (!d) return null;
  try { return new Date(d).toISOString().split('T')[0]; } catch { return null; }
}
 
function deriveLodgeFromTrip(trip, day) {
  if (!trip || !day) return null;
  const byDate = mapLodgingsByDateWithFallback(trip);
  const d = normalizeISO(day.date);
  const hit = byDate[d];
  return hit || null;
}

// String 'YYYY-MM-DD' ise aynen dön; değilse local date'ten YYYY-MM-DD üret
function toISODateSafe(d) {
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
function makeAnchorActivity(kind, src, label) {
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
const uiActivitiesRawFn = (tripObj, dayObj, anchors) => {
  if (!dayObj) return [];
  const { start, end, lodge, startLabel, endLabel } = anchors || {};

  const startA   = start   ? makeAnchorActivity('start',   start,   startLabel) : null;
  const endA     = end     ? makeAnchorActivity('end',     end,     endLabel)   : null;
  let  lodgingA  = lodge   ? makeAnchorActivity('lodging', lodge,   'Konaklama') : null;

  // Çakışanları sadeleştir
  if (lodgingA && startA && sameLoc(lodgingA.place.location, startA.place.location)) lodgingA = null;
  if (lodgingA && endA   && sameLoc(lodgingA.place.location, endA.place.location))   lodgingA = null;

  const onlyAnchors = !Array.isArray(dayObj.activities) || dayObj.activities.length === 0;
  const startEndSame = startA && endA && sameLoc(startA.place.location, endA.place.location);
  const tail = (startEndSame && onlyAnchors) ? [] : [endA];

  return [startA, ...(dayObj.activities || []), lodgingA, ...tail].filter(Boolean);
};

export default function TripPlansScreen({ route, navigation }) {
  const { tripId } = route.params || {};
  const insets = useSafeAreaInsets();
  const [datePickOpen, setDatePickOpen] = useState(false);
  const [datePickIndex, setDatePickIndex] = useState(null);
  const [datePickValue, setDatePickValue] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [trip, setTrip] = useState(null);
  const [plan, setPlan] = useState(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  const [searchBarVisible, setSearchBarVisible] = useState(false);
  const [mapSearchQ, setMapSearchQ] = useState('');
  const [searchMarkers, setSearchMarkers] = useState([]); // {id,title,coord,place_id}
  const [searchBusy, setSearchBusy] = useState(false);
  const segComputeTimerRef = useRef(null);

  // ---- uiActivitiesRaw: useCallback sarmalı (ihtiyaç varsa) ----
  const uiActivitiesRaw = useCallback(uiActivitiesRawFn, []);
  const clearSearchUI = useCallback(() => {
    setMapSearchQ('');
    setSearchMarkers([]);
    setSearchBarVisible(false);
  }, []);
  const resequenceAllDays = useCallback((baseIndex) => {
    setPlan(prev => {
      if (!prev?.days?.length) return prev;
      const next = { ...prev, days: prev.days.map(d => ({ ...d })) };
      if (!next.days.some(d => d?.date)) {
        const startISO = toISODateSafe(new Date());
        next.days.forEach((d, i) => { d.date = addDaysISO(startISO, i); });
        return next;
      }
      let anchor = baseIndex;
      if (anchor == null || !next.days[anchor]?.date) {
        anchor = next.days.findIndex(d => !!d?.date);
        if (anchor < 0) anchor = 0;
        if (!next.days[anchor]?.date) next.days[anchor].date = toISODateSafe(new Date());
      }
      const anchorISO = toISODateSafe(next.days[anchor].date) || toISODateSafe(new Date());
      for (let i = anchor - 1; i >= 0; i--) next.days[i].date = addDaysISO(anchorISO, i - anchor);
      for (let i = anchor + 1; i < next.days.length; i++) next.days[i].date = addDaysISO(anchorISO, i - anchor);
      return next;
    });
  }, []);
 
  const setDayDateAt = useCallback((idx, dateObjOrISO) => {  const iso = typeof dateObjOrISO === 'string' ? dateObjOrISO : toISODateSafe(dateObjOrISO);
  if (!iso) return;
  setPlan(prev => {
    if (!prev) return prev;
    const arr = [...(prev.days || [])];
    if (!arr[idx]) return prev;
    arr[idx] = { ...arr[idx], date: iso };
    return { ...prev, days: arr, updatedAt: new Date().toISOString() };
  });
  requestAnimationFrame(() => resequenceAllDays(idx));
}, [resequenceAllDays]);

  async function resolvePlaceIdByCoordsAndName({ name, coords, apiKey }) {
    if (!apiKey || !coords?.latitude || !coords?.longitude) return null;

    const loc = `${coords.latitude},${coords.longitude}`;
    const radius = 200;
    const lang = 'tr';
    const uid = () => `d_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    try {
      const nearbyUrl =
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
        `?location=${encodeURIComponent(loc)}` +
        `&radius=${radius}` +
        `&keyword=${encodeURIComponent(name || '')}` +
        `&language=${lang}&key=${apiKey}`;

      let res = await fetch(nearbyUrl);
      let json = await res.json();
 
      if (Array.isArray(json?.results) && json.results.length) {
        const best = json.results[0];
        if (best?.place_id) return best.place_id;
      }

      const textUrl =
        `https://maps.googleapis.com/maps/api/place/textsearch/json` +
        `?query=${encodeURIComponent(name || '')}` +
        `&location=${encodeURIComponent(loc)}` +
        `&radius=${radius}` +
        `&language=${lang}&key=${apiKey}`;

      res = await fetch(textUrl);
      json = await res.json();

      if (Array.isArray(json?.results) && json.results.length) {
        const best = json.results[0];
        if (best?.place_id) return best.place_id;
      }
    } catch (e) {
      console.warn('[PID resolve] error:', e?.message || e);
    }
    return null;
  }

  // map & focus
  const mapRef = useRef(null);
  const lastMarkerClickRef = useRef(0);
  const [focusIdx, setFocusIdx] = useState(0);
  const [selectedActId, setSelectedActId] = useState(null);
  const markerRefs = useRef({});
  const setMarkerRef = useCallback((id, ref) => { if (id) markerRefs.current[id] = ref; }, []);

  // search & map-pick
  const [searchVisible, setSearchVisible] = useState(false);
  const [insertIndex, setInsertIndex] = useState(null);

  function limitPhotos(arr, n = 2) {
    return Array.isArray(arr) ? arr.slice(0, n) : [];
  }

  const [insertMode, setInsertMode] = useState(false);
  const [pendingAdd, setPendingAdd] = useState(null);

  // QuickCard
  const [sheetMarker, setSheetMarker] = useState(null);
  const [sheetVariant, setSheetVariant] = useState('add'); // 'add' | 'preview'
  const [sheetMeta, setSheetMeta] = useState('');
  const isSheetOpen = !!sheetMarker;

  // Route Sheet & Directions
  const [routeData, setRouteData] = useState(null);
  const [routeSheetOpen, setRouteSheetOpen] = useState(false);
  const [legSel, setLegSel] = useState(null); // {from:i, to:i+1}
  const [legWaypoints, setLegWaypoints] = useState(null);
  const [legActs, setLegActs] = useState(null);
  
  // İzin Modalı State'i
  const [permissionPrompt, setPermissionPrompt] = useState(null);

  // Gün segmentleri
  const [segments, setSegments] = useState([]);

  const DIRECTIONS_API_KEY =
    Constants?.expoConfig?.extra?.GOOGLE_MAPS_API_KEY ||
    Constants?.manifest?.extra?.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    global?.GOOGLE_MAPS_API_KEY ||
    '';

  const prefs = useMemo(() => ({
    dayStart: '09:30',
    dayEnd: '20:00',
    lunchAround: '13:00',
    dinnerAround: '19:00',
    defaultDurations: { museum: 90, sights: 45, restaurants: 60, cafes: 40, parks: 40, bars: 75 },
    tempo: 'normal',
    travelMode: 'driving',
    mealSearchRadiusMeters: 1200,
    minRating: 4.2,
  }), []);

  // 🔎 gün referansı
  const planForUi = useMemo(() => {
    if (!plan || !Array.isArray(plan?.days)) return plan;
    const days = plan.days.map((d, i) => {
      if (i !== dayIndex) return { ...d, activities: d?.activities || [], items: d?.activities || [] };
      let ai = {};
      try { ai = getAnchorsForDayDetailed(trip, d) || {}; } catch { ai = {}; }
      const se = startEndForDay(trip, d) || {};
      const start = ai.start ?? se.start ?? null;
      const end   = ai.end   ?? se.end   ?? null;
      const lodge = (ai.lodge ?? ai.lodging) ?? deriveLodgeFromTrip(trip, d);

      const acts = uiActivitiesRaw(trip, d, { start, end, lodge, startLabel: ai.startLabel || 'Başlangıç', endLabel: ai.endLabel || 'Bitiş' });

      return {
        ...d,
        anchor: {
          start, end, lodge,
          startLabel: ai.startLabel || 'Başlangıç',
          endLabel: ai.endLabel || 'Bitiş',
        },
        activities: acts,
        items: acts,
      };
    });
    return { ...plan, days };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, dayIndex, trip, uiActivitiesRaw]);

  // Eski tüketici kodları için (aşağıda kullandık)
  const day = (planForUi?.days || plan?.days || [])[dayIndex] || null;

  // Anchor bilgisi (aktif gün)
  const anchorInfo = useMemo(() => {
    if (!trip || !day) {
      return { start:null, end:null, lodge:null, startLabel:'Başlangıç', endLabel:'Bitiş' };
    }
    let ai = {};
    try { ai = getAnchorsForDayDetailed(trip, day) || {}; } catch { ai = {}; }

    const se = startEndForDay(trip, day) || {};
    const start = ai.start ?? se.start ?? null;
    const end   = ai.end   ?? se.end   ?? null;
    const lodge = (ai.lodge ?? ai.lodging) ?? deriveLodgeFromTrip(trip, day);

    return {
      start, end, lodge,
      startLabel: ai.startLabel || 'Başlangıç',
      endLabel:   ai.endLabel   || 'Bitiş',
      lodgeLabel: 'Konaklama',
    };
  }, [trip, day]);

  // Günün görünen aktiviteleri (start/end/konaklama dahil)
  const uiActivities = useMemo(() => {
    if (!day) return [];
    return day.activities || [];
  }, [day]);

  const DIRECTIONS_API_KEY2 =
    Constants?.expoConfig?.extra?.GOOGLE_MAPS_API_KEY ||
    Constants?.manifest?.extra?.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    global?.GOOGLE_MAPS_API_KEY ||
    '';

  const openDayMenu = useCallback((i) => {
    Alert.alert(`Gün ${i + 1}`, 'İşlem seçin', [
      {
        text: 'Tarihi Ayarla',
        onPress: () => {
          const cur = toISODateSafe(plan?.days?.[i]?.date) || toISODateSafe(new Date());
          setDatePickIndex(i);
          setDatePickValue(new Date(cur));
          setDatePickOpen(true);
        }
      },
      { text: 'Günü Sil', style: 'destructive', onPress: () => deleteDayAt(i) },
      { text: 'Vazgeç', style: 'cancel' },
    ]);
  }, [plan, deleteDayAt]);

  const fitToSearchResults = useCallback(() => {
    if (!mapRef.current || !searchMarkers.length) return;
    const coords = searchMarkers.map(s => s.coord);
    try {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 80, bottom: 200, left: 80 },
        animated: true,
      });
    } catch {}
  }, [searchMarkers]);

  const openAddStopFromTimeline = useCallback(() => {
    setInsertIndex(0);
    setInsertMode(false);
    setIsPanelOpen(false);
    setSearchBarVisible(true);
  }, []);

  /* ===== Haritada seçim akışları ===== */

  const handlePoiClick = useCallback(async (e) => {
    if (Date.now() - lastMarkerClickRef.current < 100) return;

    const { coordinate, name, placeId } = e.nativeEvent || {};
    if (!coordinate) return;

    setIsPanelOpen(false);

    let photoUrls = [];
    try {
      if (isStrictPlaceId(placeId)) {
        const det = await getDetailsWithCache(placeId);
        if (det?.photos?.length) {
          photoUrls = limitPhotos(
            coercePhotoInputsToUrls(det.photos, DIRECTIONS_API_KEY2),
            2
          );
        }
      }
    } catch (err) {
      console.warn('[POI] details error:', err?.message || err);
    }

    setSheetVariant('add');
    setSheetMeta('');
    setSheetMarker({
      name: name || 'Seçilen yer',
      address: '',
      coords: { latitude: coordinate.latitude, longitude: coordinate.longitude },
      place_id: isStrictPlaceId(placeId) ? placeId : null,
      photoUrls,
    });
  }, [DIRECTIONS_API_KEY2]);

  const handleMapLongPress = useCallback((e) => {
    const c = e?.nativeEvent?.coordinate;
    if (!c) return;
    setIsPanelOpen(false);
    setSheetVariant('add');
    setSheetMeta('');
    setSheetMarker({
      name: 'Seçilen konum',
      coords: { latitude: c.latitude, longitude: c.longitude },
      address: '',
      photoUrls: [],
      place_id: null,
    });
  }, []);

  useEffect(() => {
    const onBack = () => { navigation.navigate('TripsHome'); return true; };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [navigation]);

  useEffect(() => { setSheetMarker(null); }, [dayIndex]);

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      const t = e.data?.action?.type;
      if (t !== 'GO_BACK' && t !== 'POP') return;
      const routes = navigation.getState()?.routes || [];
      const hasHomeBelow = routes.some((r, i) => r.name === 'TripsHome' && i < routes.length - 1);
      if (hasHomeBelow) return;
      e.preventDefault();
      navigation.navigate('TripsHome');
    });
    return sub;
  }, [navigation]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        let t = await getTripLocal(tripId);
        if (!t) { Alert.alert('Plan', 'Trip bulunamadı.'); setLoading(false); return; }
        // MINI SANITIZE: 20025 → 2025
        const _sanDate = (s) => {
          if (!s || typeof s !== 'string') return s;
          const m = s.match(/^(\d{4,5})-(\d{2})-(\d{2})$/); if (!m) return s;
          let [_, y, mo, da] = m;
          if (y.length === 5 && y.startsWith('200')) y = '20' + y.slice(3);
          const yr = +y, mm = +mo, dd = +da;
          if (yr<1900 || yr>2100 || mm<1 || mm>12 || dd<1 || dd>31) return s;
          return `${String(yr).padStart(4,'0')}-${mo}-${da}`;
        };
        let patched = false;
        if (t?.dateRange) {
          const s = _sanDate(t.dateRange.start); const e = _sanDate(t.dateRange.end);
          if (s && s !== t.dateRange.start) { t.dateRange.start = s; patched = true; }
          if (e && e !== t.dateRange.end)   { t.dateRange.end   = e; patched = true; }
        }
        if (t?._startEndSingle) {
          for (const k of ['start','end']) {
            const cur = t._startEndSingle[k];
            if (cur?.date) {
              const f = _sanDate(cur.date);
              if (f && f !== cur.date) { cur.date = f; patched = true; }
            }
          }
        }
        if (t?._startEndByCity && typeof t._startEndByCity === 'object') {
          for (const k of Object.keys(t._startEndByCity)) {
            for (const kk of ['start','end']) {
              const cur = t._startEndByCity[k]?.[kk];
              if (cur?.date) {
                const f = _sanDate(cur.date);
                if (f && f !== cur.date) { cur.date = f; patched = true; }
              }
            }
          }
        }
        if (patched) {
          try {
            await patchTripLocal(t._id ?? t.id, {
              dateRange: t.dateRange ?? null,
              _startEndSingle: t._startEndSingle ?? null,
              _startEndByCity: t._startEndByCity ?? null,
              updatedAt: new Date().toISOString(),
              __dirty: true,
            });
            console.warn('[TripPlans] dates sanitized & patched');
          } catch {}
          try { t = await getTripLocal(t._id ?? t.id) || t; } catch {}
        }
        const dbgSE = t?._startEndSingle
          ? { start: t._startEndSingle.start, end: t._startEndSingle.end }
          : null;
        console.log('✔️ Trip yüklenince veriler:', {
          anchors: dbgSE,
          lodgingsCount: Array.isArray(t?.lodgings) ? t.lodgings.length : 0,
        });

        t = await ensureResolvedForPlan(t);
        setTrip(t);

        const existing = await getPlanByTripId(tripId);
        const scratchMode = route?.params?.mode === 'scratch';

        if (existing?.days?.length && !scratchMode) {
          const normDays = (existing.days || []).filter(Boolean).map(d => ({
            ...d,
            activities: Array.isArray(d.activities) ? d.activities : (Array.isArray(d.items) ? d.items : []),
          }));
          setPlan({ ...existing, days: normDays });
        } else {
          let p = null;
          if (scratchMode) {
            p = makeEmptyPlan(tripId);
          } else {
            try {
              const tmp = await generatePlan(t, prefs, {
                useRealDirections: true,
                respectAnchors: true,
                splitByDays: true,
                maxPerDay: 12
              });
              const ok = tmp && (Array.isArray(tmp.days) || Array.isArray(tmp.items));
              if (ok) {
                const days = Array.isArray(tmp.days) ? tmp.days
                           : Array.isArray(tmp.items) ? tmp.items
                           : [{ id: uid(), date: new Date().toISOString().slice(0,10), activities: [] }];
                p = { ...tmp, days };
              }
            } catch (e) {
              console.warn('[TripPlansScreen] generatePlan failed, falling back to scratch:', e?.message);
            }
          }
          if (!p || !Array.isArray(p.days)) p = makeEmptyPlan(tripId);

          const tripKey = t?.id ?? t?._id;
          p = { ...p, tripId: tripKey, _id: p._id ?? p.id ?? `plan_${tripKey}`, id: p.id ?? p._id ?? `plan_${tripKey}` };

          try { await savePlan(p); } catch {}
          setPlan(p);
          requestAnimationFrame(() => resequenceAllDays(0));
        }

      } catch (e) {
        console.warn('[TripPlansScreen] load error', e);
        Alert.alert('Plan', 'Plan hazırlanırken hata oluştu.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tripId, prefs, resequenceAllDays, route?.params?.mode]);

  const addEmptyDay = useCallback(() => {
    setPlan(prev => {
      if (!prev) return prev;
      const days = [...(prev.days || [])];
      const lastISO = days.length
        ? toISODateSafe(days[days.length - 1]?.date)
        : toISODateSafe(new Date());
      const newISO = lastISO ? addDaysISO(lastISO, 1) : toISODateSafe(new Date());
      const newDay = { id: uid(), date: newISO, activities: [] };
      return { ...prev, days: [...days, newDay], updatedAt: new Date().toISOString() };
    });
    requestAnimationFrame(() => resequenceAllDays(null));
  }, [resequenceAllDays]);
 
  const deleteDayAt = useCallback((idx) => {
    setPlan(prev => {
      if (!prev) return prev;
      const arr = [...(prev.days || [])];
      if (arr.length <= 1) { Alert.alert('Gün', 'En az bir gün olmalı.'); return prev; }
      arr.splice(idx, 1);
      const nextIndex = Math.min(idx, arr.length - 1);
      setDayIndex(nextIndex);
      return { ...prev, days: arr, updatedAt: new Date().toISOString() };
    });
    requestAnimationFrame(() => resequenceAllDays(Math.max(0, idx - 1)));
  }, [resequenceAllDays]);

  // UI->Gerçek indeks dönüşümü
  const hasStartAnchor = uiActivities.length && uiActivities[0]?.meta?.isAnchor;
  const hasEndAnchor   = uiActivities.length && uiActivities[uiActivities.length-1]?.meta?.isAnchor;
  const uiToReal = useCallback((uiIndex) => {
    if (hasStartAnchor && uiIndex === 0) return null;                    // anchor
    if (hasEndAnchor   && uiIndex === uiActivities.length - 1) return null; // anchor
    return uiIndex - (hasStartAnchor ? 1 : 0);
  }, [uiActivities, hasStartAnchor, hasEndAnchor]);

  const guardAnchorAction = (uiIndex) => uiToReal(uiIndex) == null;

  const onTogglePanel = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (isSheetOpen) setSheetMarker(null);
    setInsertMode(false);
    setPendingAdd(null);
    setInsertIndex(null);
    setIsPanelOpen((s) => !s);
  }, [isSheetOpen]);

  const goReview = useCallback(() => {
    navigation.navigate('TripReview', { tripId });
  }, [navigation, tripId]);

  const currentMapCenter = useRef(null);
  const onMapRegionChanged = useCallback((region) => {
    if (!region) return;
    currentMapCenter.current = { lat: region.latitude, lng: region.longitude };
  }, []);
 
  useEffect(() => {
    if (!searchBarVisible) return;
    const q = (mapSearchQ || '').trim();
    if (q.length < 2) { setSearchMarkers([]); return; }
    const t = setTimeout(async () => {
      try {
        setSearchBusy(true);
        const center = currentMapCenter.current;
        const opts = center
          ? { language: 'tr', location: { lat: center.lat, lng: center.lng }, radius: 20000 }
          : { language: 'tr' };
        const preds = await autocomplete(q, opts);
        const list = Array.isArray(preds?.predictions) ? preds.predictions : (Array.isArray(preds) ? preds : []);
        const top = list.slice(0, 8);
        const detailed = [];
        for (const p of top) {
          const pid = p.place_id || p.placeId || p.id;
          if (!pid) continue;
          const det = await getPlaceDetails(pid);
          const loc = det?.coords || det?.geometry?.location;
          const lat = loc?.lat ?? loc?.latitude;
          const lng = loc?.lng ?? loc?.longitude ?? loc?.lon;
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            detailed.push({
              id: pid,
              title: det?.name || p?.description || 'Sonuç',
              place_id: pid,
              coord: { latitude: lat, longitude: lng },
              address: det?.address || p?.description || '',
              photos: Array.isArray(det?.photos) ? det.photos : [],
            });
          }
        }
        setSearchMarkers(detailed);
      } catch (e) {
        setSearchMarkers([]);
      } finally {
        setSearchBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [mapSearchQ, searchBarVisible]);

  // ---- Anchor yardımcıları & route sheet köprüleri ----

  const startAnchor = day?.anchor?.start
    ? { label: day?.anchor?.startLabel || 'Başlangıç', location: day.anchor.start }
    : (anchorInfo.start ? { label: anchorInfo.startLabel, location: anchorInfo.start } : null);

  const endAnchor = day?.anchor?.end
    ? { label: day?.anchor?.endLabel || 'Bitiş', location: day.anchor.end }
    : (anchorInfo.end ? { label: anchorInfo.endLabel, location: anchorInfo.end } : null);

  const lodgingAnchor = day?.anchor?.lodge
    ? { label: 'Konaklama', location: day.anchor.lodge }
    : (anchorInfo.lodge ? { label: anchorInfo.lodge, location: anchorInfo.lodge } : null);

  // Lat/Lon dönüştürücüler
  const toLatLng2 = (loc) => loc ? ({ lat: Number(loc.lat), lng: Number(loc.lon ?? loc.lng) }) : null;
  const toCoord  = (loc) => loc ? ({ latitude: Number(loc.lat), longitude: Number(loc.lon ?? loc.lng) }) : null;

  // RouteSheet için başlık
  const [routeLegLabel, setRouteLegLabel] = useState('');

  // Ortak: iki nokta arasını RouteSheet’te aç
  function openRouteBetween(fromLoc, toLoc, label = '') {
    if (!fromLoc || !toLoc) return;
    const wpA = toLatLng2(fromLoc);
    const wpB = toLatLng2(toLoc);
    const cA  = toCoord(fromLoc);
    const cB  = toCoord(toLoc);

    setLegWaypoints([wpA, wpB]);
    setRouteData({ polylineCoords: [cA, cB] });
    setRouteLegLabel(label);
    setRouteSheetOpen(true);
  }

  // Mini yardımcı: güvenli aktivite lokasyonu
  const actLocAt = (idx) => {
    const a = (day?.activities || [])[idx];
    return a?.place?.location || null;
  };

  /* ---- Marker’lar ---- */
  const markers = useMemo(() => {
    const acts = uiActivities || [];
    let visitNo = 0; // sadece gerçek duraklar için artacak
 
    return acts.map((a, idx) => {
        const loc = a?.place?.location;
        if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;

        const isAnchor = !!a?.meta?.isAnchor;
        const kind = a?.meta?.category;

        let baseColor = COLORS.accent;
        let orderLabel;
        if (isAnchor) {
          if (kind === 'start')   { baseColor = '#10B981'; orderLabel = '0'; }
          else if (kind === 'end'){ baseColor = '#EF4444'; orderLabel = 'B'; }
          else if (kind === 'lodging') { baseColor = '#7C3AED'; orderLabel = 'K'; }
        } else {
          if (a?.type === 'meal')     baseColor = COLORS.success;
          else if (a?.type === 'transfer') baseColor = COLORS.neutral;
          visitNo += 1;
          orderLabel = String(visitNo);
        }

        const activityId = a.id || `a_${idx}`;
        const markerKey  = `${activityId}-${idx}`;

        return {
          activity: a,
          activityId,
          key: markerKey,
          coordinate: { latitude: loc.lat, longitude: loc.lon },
          title: getActName(a, idx),
          placeId: extractPossiblePlaceIdFromActivity(a),
          baseColor,
          order: orderLabel,
          isAnchor,
          kind,
        };

      })
      .filter(Boolean);
  }, [uiActivities]);

  /* ---- Segment imzası ---- */
  const locSig = useMemo(() => {
    const acts = uiActivities || [];
    return acts.map(a => {
      const l = a?.place?.location;
      if (!l || !Number.isFinite(l.lat) || !Number.isFinite(l.lon)) return 'x';
      return `${round5k(l.lat)}:${round5k(l.lon)}`;
    }).join('|');
  }, [uiActivities]);

  /* === FIX 1: segComputeTimerRef tanımı ve güvenli kullanım === */
  const segRunIdRef = useRef(0);

  /* ---- Segmentleri hesapla ---- */
useEffect(() => {
  if (!day?.activities?.length) { 
    setSegments([]); 
    return;
  }

  if (segComputeTimerRef.current) {
    clearTimeout(segComputeTimerRef.current);
    segComputeTimerRef.current = null;
  }

  segComputeTimerRef.current = setTimeout(() => {
    computeDaySegments();
  }, 60);

  // cleanup → gün değiştirilirken/ekran kapanırken timer’ı temizle
  return () => {
    if (segComputeTimerRef.current) {
      clearTimeout(segComputeTimerRef.current);
      segComputeTimerRef.current = null;
    }
  };
}, [dayIndex, locSig, computeDaySegments]);


  // Unmount temizliği
  useEffect(() => {
    return () => {
      if (segComputeTimerRef.current) {
        clearTimeout(segComputeTimerRef.current);
        segComputeTimerRef.current = null;
      }
    };
  }, []);

  const polylineCoords = useMemo(() => {
    const poly = day?.route?.polyline;
    if (!poly || !poly.length) return null;
    return poly.map(p => ({ latitude: p.lat, longitude: p.lon }));
  }, [day?.route?.polyline]);

  const userCoords = useMemo(() => {
    const m0 = markers?.[0]?.coordinate;
    if (m0) return m0;
    const s = anchorInfo?.start;
    const l = anchorInfo?.lodge;
    const e = anchorInfo?.end;
    if (s?.lat && s?.lon) return { latitude: s.lat, longitude: s.lon };
    if (l?.lat && l?.lon) return { latitude: l.lat, longitude: l.lon };
    if (e?.lat && e?.lon) return { latitude: e.lat, longitude: e.lon };
    return { latitude: 39.93, longitude: 32.86 };
  }, [markers, anchorInfo]);

  const fitToCoords = useCallback((coords) => {
    if (!mapRef.current || !coords || !coords.length) return;
    try {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 80, bottom: 160, left: 80 },
        animated: true
      });
    } catch {}
  }, []);

  const fitMapToDay = useCallback(() => {
    const coords = polylineCoords?.length ? polylineCoords : markers.map(m => m.coordinate);
    if (coords && coords.length >= 1) {
      requestAnimationFrame(() => fitToCoords(coords));
    }
  }, [polylineCoords, markers, fitToCoords]);

  useEffect(() => {
    setFocusIdx(0);
    setSelectedActId(null);
    setLegSel(null);
    setRouteData(null);
    setSegments([]);
    setLegWaypoints(null);
    setLegActs(null);
    markerRefs.current = {};
    const t = setTimeout(fitMapToDay, 160);
    return () => clearTimeout(t);
  }, [dayIndex, fitMapToDay]);

  const retimeDay = useCallback((d) => {
    const arr = d.activities || [];
    let curMin = 9 * 60 + 30;
    for (const a of arr) {
      const hh = String(Math.floor(curMin / 60)).padStart(2, '0');
      const mm = String(curMin % 60).padStart(2, '0');
      a.start = `${hh}:${mm}`;
      curMin += a.durationMin || 45;
      const hh2 = String(Math.floor(curMin / 60)).padStart(2, '0');
      const mm2 = String(curMin % 60).padStart(2, '0');
      a.end = `${hh2}:${mm2}`;
    }
  }, []);

  const optimizeCurrentDay = useCallback(() => {
    mutatePlanDays((next)=>{
      const d = next.days?.[dayIndex];
      if (!d) return;
      const ordered = optimizeDayWithAnchors(d, trip, getAnchorsForDayDetailed);
      d.activities = ordered;

      const { start, end, lodge } = getAnchorsForDayDetailed(trip, d);
      const wps = [];
      if (start) wps.push({ lat:start.lat, lng:start.lon });
      for (const a of d.activities) {
        const l = a?.place?.location;
        if (l) wps.push({ lat: l.lat, lng: l.lon });
      }
      if (lodge && (!end || lodge.lat !== end.lat || lodge.lon !== end.lon)) {
        wps.push({ lat:lodge.lat, lng:lodge.lon });
      }
      if (end) wps.push({ lat:end.lat, lng:end.lon });
      d.route = { ...(d.route||{}), polyline: wps.map(p=>({lat:p.lat, lon:p.lng})), optimizerUsed: true };
    });
  }, [mutatePlanDays, dayIndex, trip]);

  const rebuildPolyline = useCallback((d) => {
    const pts = [];
    const acts = d.activities || [];
    for (const a of acts) {
      const loc = a?.place?.location;
      if (!loc) continue;
      pts.push({ lat: loc.lat, lon: loc.lon });
    }
    d.route = { ...(d.route || {}), polyline: pts, optimizerUsed: false };
  }, []);

  const buildWaypointFromAct = useCallback((act) => {
    const pid = act?.place?.place_id || act?.meta?.place_id || act?.gPlaceId;
    const loc = act?.place?.location;
    if (pid && typeof pid === 'string') return { place_id: pid };
    if (loc?.lat != null && loc?.lon != null) return { lat: loc.lat, lng: loc.lon };
    return null;
  }, []);

  function mapLodgingsByDate(trip) {
    return mapLodgingsByDateWithFallback(trip);
  }

  function startEndForDay(tripObj, dday) {
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
      ? { lat: se.end.hub.location.lat,   lon: (se.end.hub.location.lon ?? se.end.hub.location.lng) }
      : null;

    const start = startHub || null;
    const end   = endHub   || null;
    return { start, end };
  }

  const computeDaySegments = useCallback(async () => {
    const acts = uiActivities || [];
    if ((!acts.length) || !DIRECTIONS_API_KEY) { setSegments([]); return; }

    // Bu koşu için runId; başka güne geçilirse bu koşuyu çöpe atacağız
    const myRun = ++segRunIdRef.current;

    // UI etkileşimleri bittikten sonra çalış (donmayı keser)
    await new Promise((r) => InteractionManager.runAfterInteractions(r));

    // Küçük bir nefes (layout/anim bitsin)
    await new Promise((r) => setTimeout(r, 16));

    // Havuz: aynı anda en fazla 6 istek
    const CONCURRENCY = 6;

    // İşi bölelim (i -> i+1)
    const jobs = [];
    for (let i = 0; i < acts.length - 1; i++) {
      const a = acts[i], b = acts[i + 1];
      const w1 = buildWaypointFromAct(a);
      const w2 = buildWaypointFromAct(b);
      const la = a?.place?.location, lb = b?.place?.location;
      if (!la || !lb) continue;
      jobs.push(async () => {
        try {
          const d = (w1 && w2)
            ? await getRouteDirections({ waypoints:[w1, w2], mode:'driving', apiKey:DIRECTIONS_API_KEY })
            : null;
          const coords = (d?.polylineCoords || []).map(c => ({ latitude:c.latitude, longitude:c.longitude }));
          return coords?.length >= 2
            ? { ok:true,  coords }
            : { ok:false, coords:[ { latitude: la.lat, longitude: la.lon }, { latitude: lb.lat, longitude: lb.lon } ] };
        } catch {
          return { ok:false, coords:[ { latitude: la.lat, longitude: la.lon }, { latitude: lb.lat, longitude: lb.lon } ] };
        }
      });
    }

    // Sadelik: küçük işlerde direkt Promise.all, büyükte havuz
    const runPool = async (tasks) => {
      if (tasks.length <= CONCURRENCY) {
        return Promise.all(tasks.map(t => t()));
      }
      const out = new Array(tasks.length);
      let next = 0;
      const workers = new Array(CONCURRENCY).fill(0).map(async () => {
        while (true) {
          const i = next++;
          if (i >= tasks.length) return;
          out[i] = await tasks[i]();
          // aralarda minik nefes
          await new Promise(r => setTimeout(r, 0));
        }
      });
      await Promise.all(workers);
      return out;
    };

    // 1500ms üzerinde sürerse düz çizgi yedeğine düş (UI donmasın)
    const timeout = new Promise(resolve => setTimeout(() => resolve('__timeout__'), 1500));
    const result = await Promise.race([ runPool(jobs), timeout ]);

    if (segRunIdRef.current !== myRun) return; // başka güne geçildi

    if (result === '__timeout__') {
      // Hızlı fallback: düz çizgiler
      const nextSegs = [];
      for (let i = 0; i < acts.length - 1; i++) {
        const a = acts[i], b = acts[i + 1];
        const la = a?.place?.location, lb = b?.place?.location;
        if (!la || !lb) continue;
        nextSegs.push({ ok:false, coords:[ { latitude: la.lat, longitude: la.lon }, { latitude: lb.lat, longitude: lb.lon } ] });
      }
      setSegments(nextSegs);
      return;
    }

    setSegments((result || []).filter(Boolean));
  }, [uiActivities, DIRECTIONS_API_KEY, buildWaypointFromAct]);

  const mutatePlanDays = useCallback((updater) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        days: (prev.days || []).filter(Boolean).map(d => ({
          ...d,
          activities: Array.isArray(d?.activities) ? [...d.activities] : [],
        })),
      };
      updater(next);
      return next;
    });
  }, []);

  const focusCorridorAround = useCallback((idx) => {
    if (!mapRef.current || !day?.activities?.length) return;
    const arr = day.activities;
    const prev = arr[idx - 1]?.place?.location || null;
    const next = arr[idx]?.place?.location || arr[idx + 1]?.place?.location || null;
    let target = null;
    if (prev && next) target = { latitude: (prev.lat + next.lat) / 2, longitude: (prev.lon + next.lon) / 2 };
    else if (prev)   target = { latitude: prev.lat, longitude: prev.lon };
    else if (next)   target = { latitude: next.lat, longitude: next.lon };
    if (target) { try { mapRef.current.animateCamera({ center: target, zoom: 14 }, { duration: 450 }); } catch {} }
  }, [day?.activities]);
 
  const openAddStopAt = useCallback((idx) => {
    setSheetMarker(null);
    setInsertIndex(idx ?? 0);
    setInsertMode(false);
    if (isPanelOpen) setIsPanelOpen(false);
    requestAnimationFrame(() => focusCorridorAround(idx ?? 0));
    setSearchBarVisible(true);
  }, [isPanelOpen, focusCorridorAround]);

  const toActivityFromResolved = (resolved, label = 'Seçilen yer') => {
    const id = resolved?.key || `tmp:${Date.now()}`;
    const c = resolved?.coords;
    return {
      id,
      type: 'visit',
      durationMin: 45,
      place: {
        id,
        name: resolved?.description || label,
        location: (c?.latitude != null && c?.longitude != null)
          ? { lat: c.latitude, lon: c.longitude }
          : null,
        category: 'sights',
        address: resolved?.address || resolved?.description || '',
        photos: Array.isArray(resolved?.photoUrls) ? resolved.photoUrls.map(u => ({ url: u })) : undefined,
      },
      meta: { category: 'sights' },
    };
  };

  const addResolvedAtIndex = useCallback((idx, resolved) => {
    if (!resolved) return;
    const act = toActivityFromResolved(resolved);
    mutatePlanDays((next) => {
      const d = next.days?.[dayIndex];
      if (!d) return;
      const arr = d.activities || [];
      const pos = Math.min(Math.max(idx ?? 0, 0), arr.length);
      arr.splice(pos, 0, act);
      retimeDay(d);
      rebuildPolyline(d);
    });
  }, [dayIndex, mutatePlanDays, rebuildPolyline, retimeDay]);

  function extractPossiblePlaceId(sel) {
    const cands = [sel?.place_id, sel?.key, sel?.data?.place_id, sel?.place?.place_id, sel?.gPlaceId, sel?.id].filter(Boolean);
    return cands.find(isStrictPlaceId) || null;
  }

  const presentDetailsForSelection = useCallback(async (sel) => {
    if (isSheetOpen) setSheetMarker(null);

    const pid = extractPossiblePlaceId(sel);
    let resolved = { ...sel };

    try {
      if (pid) {
        const det = await getDetailsWithCache(pid);
        if (det) {
          resolved = {
            ...resolved,
            key: pid,
            description: det.name || sel.description || sel.name || 'Seçilen yer',
            coords: det.coords || sel.coords,
            address: det.address || sel.address,
            photoUrls: coercePhotoInputsToUrls(det.photos, DIRECTIONS_API_KEY2).slice(0, 6),
          };
        }
      }
    } catch {}

    setSearchVisible(false);

    const c = resolved?.coords;
    if (c?.latitude != null && c?.longitude != null) {
      setIsPanelOpen(false);
      try {
        mapRef.current?.animateCamera({ center: { latitude: c.latitude, longitude: c.longitude }, zoom: 15 }, { duration: 450 });
      } catch {}
      setSheetVariant('add');
      setSheetMeta('');
      setSheetMarker({
        name: resolved.description || resolved.name || 'Seçilen yer',
        address: resolved.address || '',
        coords: resolved.coords,
        place_id: pid,
        photoUrls: resolved.photoUrls || [],
      });
    }
  }, [isSheetOpen, DIRECTIONS_API_KEY2]);

  const [editIndex, setEditIndex] = useState(null);
  const applyReplaceAt = useCallback((index, resolved) => {
    mutatePlanDays((next) => {
      const d = next.days?.[dayIndex];
      if (!d) return;
      const arr = d.activities || [];
      if (index < 0 || index >= arr.length) return;
      const act = toActivityFromResolved(resolved);
      arr.splice(index, 1, act);
      retimeDay(d);
      rebuildPolyline(d);
      setSelectedActId(act.id);
    });
  }, [dayIndex, mutatePlanDays, rebuildPolyline, retimeDay]);

  const startEditAt = useCallback((index) => {
    setEditIndex(index);
    setInsertIndex(index);
    if (isPanelOpen) setIsPanelOpen(false);
    setSearchBarVisible(true);
  }, [isPanelOpen]);

  const handleOverlayCancel = useCallback(() => setSearchVisible(false), []);
  const handleOverlayMapSelect = useCallback(() => {
    setSearchVisible(false);
    const idx = (insertIndex ?? focusIdx ?? 0);
    focusCorridorAround(idx);
  }, [insertIndex, focusIdx, focusCorridorAround]);

  const handleQuickCardCta = useCallback((markerLike) => {
    const c = markerLike?.coords;
    const sel = {
      key: markerLike?.place_id || `map:${Math.round((c?.latitude ?? 0) * 1e6)}_${Math.round((c?.longitude ?? 0) * 1e6)}`,
      description: markerLike?.name || 'Seçilen konum',
      coords: c,
      address: markerLike?.address || '',
      photoUrls: markerLike?.photoUrls || [],
    };

    setSheetMarker(null);

    if (editIndex != null) {
      applyReplaceAt(editIndex, sel);
      setEditIndex(null);
      clearSearchUI?.();
      return;
    }

    const len = (day?.activities?.length || 0);
    const pickIndex = (() => {
      if (!len) return 0;
      if (typeof insertIndex === 'number') {
        return Math.min(Math.max(insertIndex, 0), len);
      }
      if (typeof focusIdx === 'number' && focusIdx >= 0 && focusIdx <= len - 1) {
        return Math.min(focusIdx + 1, len);
      }
      return len; // listenin sonu
    })();

    addResolvedAtIndex(pickIndex, sel);

    setPendingAdd(null);
    setInsertMode(false);
    setIsPanelOpen(true);
    setSearchBarVisible(false);
    setInsertIndex(null);
    clearSearchUI();    
  }, [editIndex, applyReplaceAt, day?.activities?.length, insertIndex, focusIdx, addResolvedAtIndex]);

  const handleDeleteAt = useCallback((index) => {
    mutatePlanDays((next) => {
      const d = next.days?.[dayIndex];
      if (!d) return;
      const arr = d.activities || [];
      if (index < 0 || index >= arr.length) return;
      arr.splice(index, 1);
      retimeDay(d);
      rebuildPolyline(d);
    });
  }, [dayIndex, mutatePlanDays, rebuildPolyline, retimeDay]);

  const handleReorder = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    mutatePlanDays((next) => {
      const d = next.days?.[dayIndex];
      if (!d) return;
      const arr = d.activities || [];
      const item = arr.splice(fromIndex, 1)[0];
      arr.splice(toIndex, 0, item);
      retimeDay(d);
      rebuildPolyline(d);
    });
  }, [dayIndex, mutatePlanDays, retimeDay, rebuildPolyline]);
  
  const focusActivity = useCallback((indexOrId) => {
    if (!day?.activities?.length) return;

    const fromTimeline =
      indexOrId && typeof indexOrId === 'object' && indexOrId.source === 'timeline';

    if (!day?.activities?.length || !mapRef.current) return;

    let index = -1;
    if (typeof indexOrId === 'number') {
      index = indexOrId;
    } else if (typeof indexOrId === 'string') {
      index = (day.activities || []).findIndex(a => (a.id || '') === indexOrId);
    } else if (indexOrId && typeof indexOrId === 'object' && Number.isFinite(indexOrId.index)) {
      index = indexOrId.index;
    }
    if (index < 0 || index >= (day.activities || []).length) return;

    const activity = day.activities[index];
    const actId = activity.id || String(index);
    const loc = activity?.place?.location;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return;

    const coordinate = { latitude: loc.lat, longitude: loc.lon };

    setSelectedActId(actId);
    setLegSel(null);
    setRouteData(null);

    if (!fromTimeline) {
      try {
        const ref = markerRefs.current[actId];
        ref?.showCallout?.();
      } catch {}
    }
    if (!fromTimeline && isPanelOpen) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIsPanelOpen(false);
    }

    try { mapRef.current?.animateCamera({ center: coordinate, zoom: 16 }, { duration: 350 }); } catch {}
    setTimeout(() => {
      try { mapRef.current?.animateCamera({ center: coordinate, zoom: 16 }, { duration: 350 }); } catch {}
      setTimeout(() => {
        try {
          mapRef.current?.animateToRegion({
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          }, 350);
        } catch {}
      }, 150);
    }, 280);

    if (fromTimeline) {
      setSheetMarker(null);
      return;
    }

    (async () => {
      const placeId = extractPossiblePlaceIdFromActivity(activity);

      let photoRaw = extractPhotoUrlsFromActivity(activity);
      let photoUrls = limitPhotos(
        coercePhotoInputsToUrls(photoRaw, DIRECTIONS_API_KEY2),
        2
      );

      if (photoUrls.length === 0 && placeId && isStrictPlaceId(placeId)) {
        const det = await getDetailsWithCache(placeId);
        if (det?.photos?.length) {
          photoUrls = limitPhotos(
            coercePhotoInputsToUrls(det.photos, DIRECTIONS_API_KEY2),
            2
          );
        }
      }

      setSheetVariant('preview');
      setSheetMeta(`Gün ${dayIndex + 1} • Sıra ${index + 1}`);
      setSheetMarker({
        name: getActName(activity, index) || 'Seçilen konum',
        address: activity?.place?.address || '',
        coords: coordinate,
        place_id: placeId,
        photoUrls,
      });
    })();
  }, [day, dayIndex, isPanelOpen, DIRECTIONS_API_KEY2]);

  const cityLabel = Array.isArray(trip?.cities) && trip.cities.length
    ? trip.cities.join(' • ')
    : (trip?.title || 'Gezi Planı');

  const dateLabel = trip?.dateRange?.start && trip?.dateRange?.end
    ? `${formatDate(trip.dateRange.start)} – ${formatDate(trip.dateRange.end)}`
    : '';

  const goPrevDay = useCallback(() => {
    if (!plan?.days?.length) return;
    setDayIndex(i => Math.max(0, i - 1));
  }, [plan]);
  const goNextDay = useCallback(() => {
    if (!plan?.days?.length) return;
    setDayIndex(i => Math.min(plan.days.length - 1, i + 1));
  }, [plan]);

  // GPS/İzin modalları
  async function promptToEnableGPS() {
    return new Promise(async (resolve) => {
      setPermissionPrompt({
        title: 'GPS kapalı',
        message: 'Navigasyonu başlatmak için cihazın konum servisi (GPS) açık olmalı.',
        onDismiss: () => resolve(false), 
        actions: [
          { text: 'Vazgeç', style: 'secondary', onPress: () => { setPermissionPrompt(null); resolve(false); } },
          { text: Platform.OS === 'android' ? 'GPS’i aç' : 'Ayarlar', style: 'primary',
            onPress: async () => {
              setPermissionPrompt(null);
              try {
                if (Platform.OS === 'android') {
                  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS);
                } else {
                  await Linking.openURL('app-settings:');
                }
              } catch {}
              resolve(false);
            } },
        ],
      });
    });
  }

  async function ensureLocationBeforeStart() {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      const granted = perm?.status === 'granted';

      if (!granted) {
        return new Promise(async (resolve) => {
          setPermissionPrompt({
            title: 'Konum izni gerekli',
            message: 'Navigasyonu başlatmak için konum izni gerekir.',
            onDismiss: () => resolve(false), 
            actions: [
              { text: 'Vazgeç', style: 'secondary', onPress: () => { setPermissionPrompt(null); resolve(false); } },
              { text: 'İzin ver', style: 'primary',
                onPress: async () => {
                  setPermissionPrompt(null);
                  const req = await Location.requestForegroundPermissionsAsync();
                  if (req?.status !== 'granted') return resolve(false);
                  const ok = await Location.hasServicesEnabledAsync();
                  if (ok) return resolve(true);
                  resolve(await promptToEnableGPS());
                } },
            ],
          });
        });
      }

      const services = await Location.hasServicesEnabledAsync();
      if (!services) return await promptToEnableGPS();
      return true;
    } catch {
      return false;
    }
  }

  const getCurrentDeviceLatLng = useCallback(async () => {
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (last?.coords?.latitude && last?.coords?.longitude) {
        return { lat: last.coords.latitude, lng: last.coords.longitude };
      }
    } catch {}
    try {
      const cur = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        maximumAge: 5000,
        timeout: 6000,
      });
      if (cur?.coords?.latitude && cur?.coords?.longitude) {
        return { lat: cur.coords.latitude, lng: cur.coords.longitude };
      }
    } catch (e) {
      console.warn('[getCurrentDeviceLatLng] error', e?.message);
    }
    return null;
  }, []);

  const pickLeg = useCallback(async (fromIdx) => {
    const acts = day?.activities || [];
    const a = acts[fromIdx];
    const b = acts[fromIdx + 1];
    if (!a || !b) return;

    const w1 = buildWaypointFromAct(a);
    const w2 = buildWaypointFromAct(b);
    if (!w1 || !w2 || !DIRECTIONS_API_KEY) return;

    setLegSel({ from: fromIdx, to: fromIdx + 1 });
    setLegActs({ a, b });
    setLegWaypoints([w1, w2]);
    setIsPanelOpen(false);

    try {
      const data = await getRouteDirections({
        waypoints: [w1, w2],
        mode: 'driving',
        apiKey: DIRECTIONS_API_KEY
      });
      setRouteData(data);
      setRouteSheetOpen(true);

      if (data?.polylineCoords?.length) {
        fitToCoords(data.polylineCoords);
      } else {
        const ca = a.place.location;
        const cb = b.place.location;
        if (ca && cb) {
          fitToCoords([
            { latitude: ca.lat, longitude: ca.lon },
            { latitude: cb.lat, longitude: cb.lon },
          ]);
        }
      }
    } catch (e) {
      console.warn('[LegDirections] err', e?.message);
      setRouteData(null);
      setRouteSheetOpen(true);
    }
  }, [day?.activities, buildWaypointFromAct, DIRECTIONS_API_KEY, fitToCoords]);

  const pickLegFromStartAnchor = useCallback(async () => {
    const acts = day?.activities || [];
    if (!acts.length || !DIRECTIONS_API_KEY) return;

    const { start } = anchorInfo;
    const first = acts[0];
    if (!start || !first?.place?.location) return;

    setLegSel({ from: -1, to: 0 });
    setLegActs({ a: { place: { location: { lat: start.lat, lon: start.lon } }, place_id: null },
                 b: first });

    const w1 = { lat: start.lat, lng: start.lon };
    const w2 = buildWaypointFromAct(first);
    setIsPanelOpen(false);

    try {
      const data = await getRouteDirections({ waypoints: [w1, w2], mode: 'driving', apiKey: DIRECTIONS_API_KEY });
      setRouteData(data);
      setRouteSheetOpen(true);
      if (data?.polylineCoords?.length) fitToCoords(data.polylineCoords);
    } catch {
      const ca = { latitude: start.lat, longitude: start.lon };
      const cb = { latitude: first.place.location.lat, longitude: first.place.location.lon };
      fitToCoords([ca, cb]);
      setRouteData(null);
      setRouteSheetOpen(true);
    }
  }, [day, anchorInfo, DIRECTIONS_API_KEY, buildWaypointFromAct, fitToCoords]);

  const pickLegToEndAnchor = useCallback(async () => {
    const acts = day?.activities || [];
    if (!acts.length || !DIRECTIONS_API_KEY) return;

    const { end } = anchorInfo;
    const last = acts[acts.length - 1];
    if (!end || !last?.place?.location) return;

    setLegSel({ from: acts.length - 1, to: acts.length });
    setLegActs({ a: last, b: { place: { location: { lat: end.lat, lon: end.lon } }, place_id: null } });

    const w1 = buildWaypointFromAct(last);
    const w2 = { lat: end.lat, lng: end.lon };
    setIsPanelOpen(false);

    try {
      const data = await getRouteDirections({ waypoints: [w1, w2], mode: 'driving', apiKey: DIRECTIONS_API_KEY });
      setRouteData(data);
      setRouteSheetOpen(true);
      if (data?.polylineCoords?.length) fitToCoords(data.polylineCoords);
    } catch {
      const ca = { latitude: last.place.location.lat, longitude: last.place.location.lon };
      const cb = { latitude: end.lat, longitude: end.lon };
      fitToCoords([ca, cb]);
      setRouteData(null);
      setRouteSheetOpen(true);
    }
  }, [day, anchorInfo, DIRECTIONS_API_KEY, buildWaypointFromAct, fitToCoords]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ color: '#ddd', marginTop: 8 }}>Plan hazırlanıyor…</Text>
      </View>
    );
  }
  if (!trip || !plan || !Array.isArray(plan?.days)) {
    return (
      <View style={styles.center}>
        <Text style={{ color: '#ddd' }}>Plan bulunamadı.</Text>
      </View>
    );
  }

  return (
  <View style={styles.screen}>
    {/* Üst Header */}
    <View style={[styles.header, { paddingTop: insets.top, minHeight: 56 + insets.top }]}>
      <TouchableOpacity
        onPress={() => navigation.navigate('TripsHome')}
        style={styles.backBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Geri"
      >
        <Ionicons name="chevron-back" size={20} color={COLORS.fg} />
      </TouchableOpacity>

      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text style={styles.headerCity} numberOfLines={1}>{cityLabel}</Text>
        {!!dateLabel && <Text style={styles.headerDates} numberOfLines={1}>{dateLabel}</Text>}
      </View>

      <TouchableOpacity onPress={goReview} style={styles.replanBtnHeader} hitSlop={8} accessibilityLabel="Yeniden Planla">
        <Ionicons name="chevron-forward" size={16} color={COLORS.fg} style={{ marginRight: 6 }} />
        <Text style={styles.replanText}>Yeniden Planla</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => setSearchBarVisible(true)}
        style={styles.iconOnlyBtn}
        accessibilityLabel="Haritada ara"
      >
        <Ionicons name="search" size={18} color={COLORS.fg} />
      </TouchableOpacity>
    </View>

    {/* Gün şeridi */}
    <View style={styles.daysBar} pointerEvents="auto">
      <View style={styles.dayArrows}>
        <Pressable onPress={goPrevDay} style={styles.dayArrowBtn} hitSlop={10} accessibilityLabel="Önceki gün">
          <Ionicons name="caret-back" size={18} color={COLORS.fg} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 10, alignItems: 'center' }}
      >
        {(plan?.days || []).filter(Boolean).map((d, i) => {
          const active = i === dayIndex;
          return (
            <View key={String(d?.id ?? `${i}-${d?.date ?? 'nodate'}`)}
              style={{ flexDirection:'row', alignItems:'center', marginHorizontal: 4 }}>
              <Pressable
                onPress={() => setDayIndex(i)}
                style={[styles.dayChip, active && styles.dayChipActive]}
                hitSlop={8}
                accessibilityLabel={`Gün ${i + 1}`}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>
                  {`Gün ${i + 1}`} • {formatDate(d.date)}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => openDayMenu(i)}
                hitSlop={10}
                style={{ padding: 6, marginLeft: -2 }}
                accessibilityLabel={`Gün ${i + 1} menü`}
              >
                <Ionicons name="ellipsis-vertical" size={16} color={COLORS.fg} />
              </Pressable>
            </View>
          );
        })}

        <Pressable
          onPress={addEmptyDay}
          style={[styles.dayChip, { borderStyle: 'dashed', opacity: 0.9 }]}
          hitSlop={8}
          accessibilityLabel="Gün ekle"
        >
          <Text style={styles.dayChipText}>+ Gün</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.dayArrows}>
        <Pressable onPress={goNextDay} style={styles.dayArrowBtn} hitSlop={10} accessibilityLabel="Sonraki gün">
          <Ionicons name="caret-forward" size={18} color={COLORS.fg} />
        </Pressable>
      </View>
    </View>

    {/* İçerik alanı */}
    <View style={styles.content}>
      {/* Sol Panel */}
      <View
        style={[
          styles.side,
          {
            width: isPanelOpen ? LEFT_OPEN_W : LEFT_CLOSED_W,
            elevation: isSheetOpen ? 0 : 4,
            zIndex: isSheetOpen ? 0 : 2
          },
          (!isPanelOpen || isSheetOpen) && { pointerEvents: 'none' },
        ]}
      >
        {(!day?.activities || day.activities.length === 0) && (
          <View style={{ padding: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border }}>
            <TouchableOpacity
              onPress={openAddStopFromTimeline}
              style={{ backgroundColor: COLORS.accent, paddingVertical: 10, alignItems:'center', borderRadius: 10 }}
            >
              <Text style={{ color:'#fff', fontWeight:'800' }}>Durak ekle</Text>
            </TouchableOpacity>
          </View>
        )}

        <SideTimeline
          isOpen={isPanelOpen}
          plan={planForUi}
          dayIndex={dayIndex}
          setDayIndex={setDayIndex}

          /* ✅ Anchor tıklaması */
          onSelect={(payload) => {
            // Eğer SideTimeline doğrudan koordinat verdiyse, indeksle uğraşma: direkt o noktaya git.
            if (payload && payload.coordOnly && payload.coord && payload.coord.lat != null && payload.coord.lon != null) {
              try {
                mapRef.current?.animateCamera({
                  center: { latitude: Number(payload.coord.lat), longitude: Number(payload.coord.lon) },
                  zoom: 16,
                }, { duration: 350 });
              } catch {}
              return;
            }
            if (payload && payload.anchor) {
              const c = payload.coord;
              if (c?.lat != null && c?.lon != null) {
                mapRef.current?.animateCamera({
                  center: { latitude: Number(c.lat), longitude: Number(c.lon) },
                  zoom: 15,
                }, { duration: 350 });
              } else if (day?.activities?.length) {
                if (payload.anchor === 'start') focusActivity({ index: 0, source: 'timeline' });
                if (payload.anchor === 'end')   focusActivity({ index: day.activities.length - 1, source: 'timeline' });
              }
              return;
            }
            const uiIdx = typeof payload === 'object' ? payload.index : payload;
            if (guardAnchorAction(uiIdx)) {
              if ((day?.activities || []).length > 0) focusActivity({ index: 0, source: 'timeline' });
              return;
            }
            const real = uiToReal(uiIdx);
            if (real != null) focusActivity({ index: real, source: 'timeline' });
          }}
          onInsertAt={(realIdxOrUi) => {
            const idx = typeof realIdxOrUi === 'number' ? realIdxOrUi : uiToReal(realIdxOrUi);
            if (idx == null || idx < 0) return;
            openAddStopAt(idx);
          }}
          onEditAt={(uiIdx) => {
            if (guardAnchorAction(uiIdx)) return;
            startEditAt(uiToReal(uiIdx));
          }}
          onDeleteAt={(uiIdx) => {
            if (guardAnchorAction(uiIdx)) return;
            handleDeleteAt(uiToReal(uiIdx));
          }}
          onReorder={(fromUi, toUi) => {
            if (guardAnchorAction(fromUi) || guardAnchorAction(toUi)) return;
            handleReorder(uiToReal(fromUi), uiToReal(toUi));
          }}
          insertMode={insertMode}
          onPickInsertIndex={(realIdxOrUi) => {
            const real = typeof realIdxOrUi === 'number' ? realIdxOrUi : uiToReal(realIdxOrUi);
            if (real == null || real < 0) return;
            if (pendingAdd) addResolvedAtIndex(real, pendingAdd);
            setPendingAdd(null);
            setInsertMode(false);
            setInsertIndex(null);
            clearSearchUI();
          }}
          onCancelInsertMode={() => {
            setPendingAdd(null);
            setInsertMode(false);
            setInsertIndex(null);
          }}

          /* Eski: durak→durak */
          onPickLeg={(uiFrom) => {
            if (hasStartAnchor && uiFrom === 0) { pickLegFromStartAnchor(); return; }
            const lastIdx = uiActivities.length - 1;
            const isToEnd = hasEndAnchor && uiFrom === lastIdx - 1;
            if (isToEnd) { pickLegToEndAnchor(); return; }
            const fromIsAnchor = guardAnchorAction(uiFrom);
            const nextIsAnchor = guardAnchorAction(uiFrom + 1);
            if (fromIsAnchor && !nextIsAnchor) return;
            if (!fromIsAnchor && nextIsAnchor) { pickLeg(uiToReal(uiFrom)); return; }
            if (guardAnchorAction(uiFrom) || guardAnchorAction(uiFrom + 1)) return;
            const realFrom = uiToReal(uiFrom);
            const arrLen = (day?.activities || []).length;
            if (realFrom == null || realFrom < 0 || realFrom >= arrLen - 1) return;
            pickLeg(realFrom);
          }}

          /* ✅ Yeni: anchor komşuları (Start/End/Lodging) */
          startAnchor={startAnchor}
          endAnchor={endAnchor}
          lodgingAnchor={lodgingAnchor}
          anchorLabels={{ start: anchorInfo.startLabel, end: anchorInfo.endLabel, lodging: 'Konaklama' }}
          onPickStartLeg={(toIndex) => {
            const from = startAnchor?.location;
            const to   = actLocAt(toIndex);
            if (from && to) openRouteBetween(from, to, `Başlangıç → Durak ${toIndex + 1}`);
          }}
          onPickEndLeg={(fromIndex) => {
            const from = actLocAt(fromIndex);
            const to   = endAnchor?.location;
            if (from && to) openRouteBetween(from, to, `Durak ${fromIndex + 1} → Bitiş`);
          }}
          onPickLodgingLeg={(side, index) => {
            const lodge = lodgingAnchor?.location;
            const act   = actLocAt(index);
            if (!lodge || !act) return;
            if (side === 'before') {
              openRouteBetween(act, lodge, `Durak ${index + 1} → Konaklama`);
            } else {
              openRouteBetween(lodge, act, `Konaklama → Durak ${index + 1}`);
            }
          }}
          onPickLegPair={async ({ from, to }) => {
            setIsPanelOpen(false);
            setLegSel(null);
            setLegActs({
              a: { place: { location: { lat: Number(from.loc.lat), lon: Number(from.loc.lon) } } },
              b: { place: { location: { lat: Number(to.loc.lat),   lon: Number(to.loc.lon)   } } },
            });

            const w1 = { lat: Number(from.loc.lat), lng: Number(from.loc.lon) };
            const w2 = { lat: Number(to.loc.lat),   lng: Number(to.loc.lon)   };
            setLegWaypoints([w1, w2]);

            const cA = { latitude: w1.lat, longitude: w1.lng };
            const cB = { latitude: w2.lat, longitude: w2.lng };
            setRouteData({ polylineCoords: [cA, cB] });

            const short = (k) => (k === 'start' ? '0' : k === 'end' ? 'B' : k === 'lodging' ? 'K' : null);
            const labelL = short(from.kind) ?? '';
            const labelR = short(to.kind)   ?? '';

            const acts = (day?.activities || []).filter(a => !a?.meta?.isAnchor);
            const numOf = (coord) => {
              const i = acts.findIndex(a => {
                const l = a?.place?.location;
                return l && Math.abs(l.lat - coord.lat) < 1e-7 && Math.abs((l.lon ?? l.lng) - coord.lon) < 1e-7;
              });
              return i >= 0 ? (i + 1) : null;
            };
            const nL = (from.kind === 'activity') ? numOf(from.loc) : null;
            const nR = (to.kind   === 'activity') ? numOf(to.loc)   : null;

            const legLabel = `${labelL || nL || '?'} → ${labelR || nR || '?'}`;
            setRouteLegLabel(legLabel);

            try {
              if (DIRECTIONS_API_KEY) {
                const data = await getRouteDirections({
                  waypoints: [w1, w2],
                  mode: 'driving',
                  apiKey: DIRECTIONS_API_KEY
                });
                if (data?.polylineCoords?.length) {
                  setRouteData(data);
                }
              }
            } catch {}

            setRouteSheetOpen(true);
            try { fitToCoords([cA, cB]); } catch {}
          }}
        />
        
      </View>

      {/* Orta toggle + Arama Barı */}
      <View style={styles.toggleOverlay} pointerEvents="box-none">
        {searchBarVisible && (
          <View style={styles.searchBarWrap} pointerEvents="box-none">
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color="#111" />
              <TextInput
                style={styles.searchInput}
                value={mapSearchQ}
                onChangeText={setMapSearchQ}
                placeholder="Haritada ara: Örn. Starbucks"
                placeholderTextColor="#6B7280"
                autoFocus
                returnKeyType="search"
              />
              {!!searchMarkers.length && !searchBusy && (
                <TouchableOpacity
                  onPress={fitToSearchResults}
                  style={{ paddingHorizontal:10, paddingVertical:6, borderRadius:8, backgroundColor:'#E5E7EB', marginRight:6 }}
                >
                  <Text style={{ fontWeight:'800', color:'#111' }}>Git</Text>
                </TouchableOpacity>
              )}
              {searchBusy ? (
                <ActivityIndicator size="small" />
              ) : (
                <TouchableOpacity
                  onPress={() => { setMapSearchQ(''); setSearchMarkers([]); setSearchBarVisible(false); }}
                  style={styles.searchCloseBtn}
                >
                  <Ionicons name="close" size={16} color="#111" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        <View
          style={[
            styles.panelToggleWrapper,
            isPanelOpen
              ? { left: (isPanelOpen ? LEFT_OPEN_W : LEFT_CLOSED_W) - TOGGLE_SIZE / 2 + 8 }
              : { left: -TOGGLE_SIZE / 2 + TOGGLE_PEEK }
          ]}
        >
          <Pressable style={styles.panelToggleHitZone} onPress={onTogglePanel}>
            <View style={styles.panelToggle}>
              <Ionicons name={isPanelOpen ? 'chevron-back' : 'chevron-forward'} size={18} color="#000" />
            </View>
          </Pressable>
        </View>
      </View>

      {/* Harita */}
      <View style={[styles.mapWrap, { width: SCREEN_W - (isPanelOpen ? LEFT_OPEN_W : LEFT_CLOSED_W) }]}>
        <MapView
          ref={mapRef}
          style={styles.map}
          pointerEvents="auto"
          showsPointsOfInterest={true}
          onPoiClick={handlePoiClick}
          onLongPress={handleMapLongPress}
          onRegionChangeComplete={(r) => { onMapRegionChanged(r); }}
          initialRegion={{
            latitude: markers?.[0]?.coordinate?.latitude || 39.93,
            longitude: markers?.[0]?.coordinate?.longitude || 32.86,
            latitudeDelta: 0.15,
            longitudeDelta: 0.15,
          }}
        >
          {/* Arama sonuç marker'ları */}
          {searchMarkers.map(sm => (
            <Marker
              key={`srch-${sm.id}`}
              coordinate={sm.coord}
              title={sm.title}
              pinColor="#111827"
              tracksViewChanges={false}
              onPress={() => {
                // Quick preview açmak istiyorsak:
                setIsPanelOpen(false);
setSheetVariant('add');
setSheetMeta('');
setSheetMarker({
  name: sm.title,
  address: sm.address || '',
  coords: sm.coord,
  place_id: sm.place_id || null,
  photoUrls: limitPhotos(coercePhotoInputsToUrls(sm.photos, DIRECTIONS_API_KEY2), 2),
});

// 1) ÖNCE sel’i oluştur
const sel = {
  key: sm.place_id || sm.id,
  description: sm.title,
  coords: sm.coord,
  address: sm.address || '',
  photoUrls: sm.photos || [],
};

// 2) insertIndex verilmişse direkt oraya ekle
if (insertIndex != null) {
  addResolvedAtIndex(insertIndex, sel);
  setInsertIndex(null);
  setPendingAdd(null);
  setInsertMode(false);
  setIsPanelOpen(true);
  clearSearchUI?.();
  return;
}

// 3) Aksi halde akıllı ekleme pozisyonunu hesapla ve ekle
const len = (day?.activities?.length || 0);
const pickIndex = (() => {
  if (!len) return 0;
  if (typeof insertIndex === 'number') return Math.min(Math.max(insertIndex, 0), len);
  if (typeof focusIdx === 'number' && focusIdx >= 0 && focusIdx <= len - 1) return Math.min(focusIdx + 1, len);
  return len;
})();

addResolvedAtIndex(pickIndex, sel);
clearSearchUI();
setPendingAdd(null);
setInsertMode(false);
setIsPanelOpen(true);

              }}
            />
          ))}

          {/* Çizgiler */}
          {routeData?.polylineCoords?.length ? (
            <Polyline
              coordinates={routeData.polylineCoords}
              strokeWidth={6}
              tappable
              onPress={() => setRouteSheetOpen(true)}
              zIndex={1}
            />
          ) : segments.length ? (
            segments.map((s, idx) => (
              <Polyline
                key={`seg-${idx}`}
                coordinates={s.coords}
                strokeWidth={5}
                strokeColor={s.ok ? undefined : '#888'}
                tappable={true}
                onPress={() => {
                  const merged = { polylineCoords: s.coords };
                  setRouteData(merged);
                  setRouteSheetOpen(true);
                }}
                zIndex={0}
              />
            ))
          ) : (polylineCoords && (
            <Polyline
              coordinates={polylineCoords}
              strokeWidth={5}
              tappable={false}
              zIndex={0}
            />
          ))}

          {markers.map(m => {
            const isSel = m.activityId === selectedActId;
            const pinBg = isSel ? '#FF7A00' : m.baseColor;

            return (
              <Marker
                key={m.key}
                ref={(ref) => setMarkerRef(m.activityId, ref)}
                coordinate={m.coordinate}
                title={m.title}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
                zIndex={10}
                onPress={async () => {
                  lastMarkerClickRef.current = Date.now();

                  setSelectedActId(m.activityId);
                  setIsPanelOpen(false);
                  setLegSel(null);
                  setRouteData(null);

                  let photoRaw = extractPhotoUrlsFromActivity(m.activity);
                  let photoUrls = limitPhotos(
                    coercePhotoInputsToUrls(photoRaw, DIRECTIONS_API_KEY2),
                    2
                  );

                  if (!isStrictPlaceId(m.placeId)) {
                    const pid = await resolvePlaceIdByCoordsAndName({
                      name: m.title,
                      coords: { latitude: m.coordinate.latitude, longitude: m.coordinate.longitude },
                      apiKey: DIRECTIONS_API_KEY2,
                    });
                    if (pid) m.placeId = pid;
                  }

                  if (photoUrls.length === 0 && isStrictPlaceId(m.placeId)) {
                    try {
                      const det = await getDetailsWithCache(m.placeId);
                      if (det?.photos?.length) {
                        photoUrls = limitPhotos(
                          coercePhotoInputsToUrls(det.photos, DIRECTIONS_API_KEY2),
                          2
                        );
                      }
                    } catch (err) {
                      console.warn('[Marker] details error:', err?.message || err);
                    }
                  }

                  setSheetVariant('preview');
                  setSheetMeta(`Gün ${dayIndex + 1} • Sıra ${m.order}`);
                  setSheetMarker({
                    name: m.title || 'Seçilen konum',
                    address: m.activity?.place?.address || '',
                    coords: { latitude: m.coordinate.latitude, longitude: m.coordinate.longitude },
                    place_id: isStrictPlaceId(m.placeId) ? m.placeId : null,
                    photoUrls,
                  });
                }}
              >
                <NumMarker bg={pinBg} order={m.order} />
              </Marker>
            );
          })}
        </MapView>
      </View>
    </View>

    {/* Quick Card */}
    <View style={styles.quickLayer} pointerEvents="box-none">
      <PlaceQuickCard
        visible={isSheetOpen}
        marker={sheetMarker}
        onDismiss={() => setSheetMarker(null)}
        ctaLabel={editIndex != null ? 'Durağı değiştir' : 'Durak ekle'}
        onCtaPress={handleQuickCardCta}
        variant={sheetVariant}
        metaLabel={sheetMeta}
      />
    </View>

    {/* Route Sheet */}
    <TripRouteSheet
      visible={routeSheetOpen}
      waypoints={legWaypoints}
      apiKey={DIRECTIONS_API_KEY}
      preferredMode="driving"
      previewData={routeData}
      legLabel={routeLegLabel}
      previewTitle={
        (legActs?.a && legActs?.b)
          ? `${getActName(legActs.a, legSel?.from ?? 0)} → ${getActName(legActs.b, legSel?.to ?? 0)}`
          : undefined
      }
      onClose={() => {
        setRouteSheetOpen(false);
        setRouteData(null);
        setRouteLegLabel('');
        setIsPanelOpen(true);
      }}
      onStart={async ({ mode, waypoints, summary, leg }) => {
        const ok = await ensureLocationBeforeStart();
        if (!ok) return;
        setRouteSheetOpen(false);

        try {
          const b = legActs?.b;
          const a = legActs?.a;
          if (!b?.place?.location) return;

          const cur = await getCurrentDeviceLatLng();
          if (!cur) { Alert.alert('Konum', 'Mevcut konum alınamadı.'); return; }

          const la = { lat: cur.lat, lon: cur.lng };
          const lb = b.place.location;

          let navRoute = null;
          try {
            navRoute = await getRouteDirections({
               waypoints: [{ lat: la.lat, lng: la.lng }, { lat: lb.lat, lng: (lb.lon ?? lb.lng) }],
              mode: mode || 'driving',
              apiKey: DIRECTIONS_API_KEY,
            });
          } catch (e) { console.warn('[Nav fresh route] error', e?.message); }

          const asEncodedString = (rd) => {
            if (!rd) return null;
            if (typeof rd.polyline === 'string' && rd.polyline.trim()) return rd.polyline.trim();
            if (typeof rd.encoded === 'string' && rd.encoded.trim()) return rd.encoded.trim();
            const op = rd.overview_polyline;
            if (typeof op === 'string' && op.trim()) return op.trim();
            if (op && typeof op === 'object' && typeof op.points === 'string' && op.points.trim()) return op.points.trim();
            return null;
          };

          const encoded = asEncodedString(navRoute);
          const polylineCoordsSafe = Array.isArray(navRoute?.polylineCoords) ? navRoute.polylineCoords : null;
          const stepsSafe = Array.isArray(navRoute?.legs) ? navRoute.legs : null;

          const nameB = getActName(b, legSel?.to ?? 0);
          const pidB = extractPossiblePlaceIdFromActivity(b) || null;
          const nameA = getActName(a, legSel?.from ?? 0);

          const destOrderNum = (legSel?.to ?? 0) + 1;

          const navPayload = {
            entryPoint: 'turn-by-turn',
            from: { latitude: la.lat, longitude: la.lng, name: 'Mevcut Konum', place_id: null },
            to:   { latitude: lb.lat, longitude: (lb.lon ?? lb.lng), name: nameB, place_id: pidB },
            prevStop: a?.place?.location
             ? { latitude: a.place.location.lat, longitude: (a.place.location.lon ?? a.place.location.lng), order: (legSel?.from ?? 0) + 1, name: nameA }
              : null,
            nextStop: { latitude: lb.lat, longitude: lb.lon, order: destOrderNum, name: nameB },
            waypoints: [],
            mode: mode || 'driving',
            polylineEncoded: encoded || null,
            polyline: encoded || null,
            polylineCoords: polylineCoordsSafe,
            steps: stepsSafe,
            ui: {
              showUserMarker: false,
              showDestinationMarker: true,
              showPrevStopMarker: true,
              prevStopNumber: (legSel?.from ?? 0) + 1,
            },
          };

          navigateToTurnByTurn(navigation, navPayload);
        } catch (e) {
          console.warn('[NavigationStart] payload error', e?.message);
        }
      }}
    />

    {/* İzin Modalı */}
    <PermissionPromptModal
      visible={!!permissionPrompt}
      title={permissionPrompt?.title}
      message={permissionPrompt?.message}
      actions={permissionPrompt?.actions}
      onDismiss={() => {
        setPermissionPrompt(null);
        permissionPrompt?.onDismiss?.();
      }}
    />

    {/* Tarih seçimi */}
    {datePickOpen && (
      <Modal transparent animationType="fade" onRequestClose={() => setDatePickOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setDatePickOpen(false)} />
        <View style={styles.calCard}>
          <Calendar
            initialDate={toISODateSafe(datePickValue)}
            onDayPress={(d) => {
              if (datePickIndex != null) setDayDateAt(datePickIndex, d.dateString);
              setDatePickOpen(false);
            }}
            markedDates={{ [toISODateSafe(datePickValue)]: { selected: true } }}
            enableSwipeMonths
            theme={{
              backgroundColor: '#0D0F14',
              calendarBackground: '#0D0F14',
              textSectionTitleColor: '#9AA0A6',
              selectedDayBackgroundColor: '#2563EB',
              selectedDayTextColor: '#ffffff',
              todayTextColor: '#2563EB',
              dayTextColor: '#ffffff',
              monthTextColor: '#ffffff',
              textDisabledColor: '#6B7280',
              arrowColor: '#ffffff',
            }}
          />
        </View>
      </Modal>
    )}
  </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgApp },

  header: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.bgCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    zIndex: 200,
    elevation: 8,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F3F4F6', marginRight: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
  },
  headerCity: { color: COLORS.fg, fontSize: 16, fontWeight: '800', lineHeight: 20 },
  headerDates: { color: COLORS.fgMuted, fontSize: 12, marginTop: 2 },

  quickLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    elevation: 2000,
    pointerEvents: 'box-none',
  },

  replanBtnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#EEF2F7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  replanText: { color: COLORS.fg, fontWeight: '800' },

  daysBar: {
    minHeight: 56,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: COLORS.bgCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 190,
    elevation: 7,
  },
  dayArrows: { width: 34, alignItems: 'center', justifyContent: 'center' },
  dayArrowBtn: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },

  dayChip: {
    marginHorizontal: 4,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#F3F4F6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  dayChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  dayChipText: { color: COLORS.fg, fontWeight: '700', fontSize: 12 },
  dayChipTextActive: { color: '#fff' },

  content: { flex: 1, flexDirection: 'row', position: 'relative' },

  side: {
    zIndex: 999,
    backgroundColor: COLORS.bgCard,
    borderRightWidth: 0,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 24,
  },

  iconOnlyBtn: {
    marginLeft: 8,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#EEF2F7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  searchBarWrap: {
    position: 'absolute', top: 12, left: 12, right: 12,
    zIndex: 2000, elevation: 2000,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB',
  },
  searchInput: { flex: 1, color: '#111' },
  searchCloseBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },
  toggleOverlay: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    justifyContent: 'center',
    zIndex: 10,
    elevation: 20,
    pointerEvents: 'box-none',
  },
  panelToggleWrapper: {
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -TOGGLE_SIZE / 2 }],
  },
  panelToggleHitZone: {
    width: TOGGLE_SIZE + 32,
    height: TOGGLE_SIZE + 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelToggle: {
    width: TOGGLE_SIZE, height: TOGGLE_SIZE, borderRadius: TOGGLE_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.bgCard,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },

  mapWrap: { backgroundColor: '#EEF2F7' },
  map: { flex: 1, zIndex: 0, elevation: 0 },

  numMarkerInner: {
    minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  numMarkerText: { color: '#fff', fontWeight: '800', fontSize: 13, includeFontPadding: false },
  numMarkerTip: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    marginTop: -1,
    borderTopColor: COLORS.accent,
  },

  calCard: {
    position: 'absolute',
    left: 16, right: 16, bottom: 24,
    backgroundColor: '#0D0F14',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#23262F',
    padding: 8,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0D12' },

  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
});
