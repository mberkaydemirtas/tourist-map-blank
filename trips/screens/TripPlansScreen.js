//trips/screens/TripPlansScreen.js
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Dimensions, ActivityIndicator, Alert,
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
import GetDirectionsOverlay from '../../map/components/GetDirectionsOverlay';
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

const LEFT_OPEN_W = Math.min(380, SCREEN_W * 0.42);
const LEFT_CLOSED_W = 0;
const TOGGLE_PEEK = 12;
const TOGGLE_SIZE = 44;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ---------- helpers ---------- */
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
  const p = new URLSearchParams({ photoreference: String(photoRef), maxwidth: String(maxwidth), key: apiKey });
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

export default function TripPlansScreen({ route, navigation }) {
  const { tripId } = route.params || {};
  const insets = useSafeAreaInsets();

  const anchorInfo = getAnchorsForDayDetailed(trip, day);

  const [loading, setLoading] = useState(true);
  const [trip, setTrip] = useState(null);
  const [plan, setPlan] = useState(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  async function resolvePlaceIdByCoordsAndName({ name, coords, apiKey }) {
    if (!apiKey || !coords?.latitude || !coords?.longitude) return null;

    const loc = `${coords.latitude},${coords.longitude}`;
    const radius = 200;
    const lang = 'tr';

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
            coercePhotoInputsToUrls(det.photos, DIRECTIONS_API_KEY),
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
  }, [DIRECTIONS_API_KEY]);

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
        t = await ensureResolvedForPlan(t);
        setTrip(t);

        const existing = await getPlanByTripId(tripId);
        if (existing?.days?.length) {
          setPlan(existing);
        } else {
          let p = await generatePlan(t, prefs, { useRealDirections: true });
          p = { ...p, tripId: t._id, _id: p._id ?? p.id ?? `plan_${t._id}`, id: p.id ?? p._id ?? `plan_${t._id}` };
          await savePlan(p);
          setPlan(p);
        }
      } catch (e) {
        console.warn('[TripPlansScreen] load error', e);
        Alert.alert('Plan', 'Plan hazırlanırken hata oluştu.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tripId, prefs]);

  const day = useMemo(() => (Array.isArray(plan?.days) ? plan.days[dayIndex] : null) || null, [plan, dayIndex]);

  // UI için, günün başına ve sonuna anchor eklenmiş “görüntü” listesi
const uiActivities = useMemo(() => {
  if (!day) return [];
  const { start, end, lodge, startLabel, endLabel } = getAnchorsForDayDetailed(trip, day);

  const startA   = makeAnchorActivity('start',   start,   startLabel);
  const lodgingA = lodge && (!coordsEqual(lodge, start) && !coordsEqual(lodge, end))
                    ? makeAnchorActivity('lodging', lodge, 'Konaklama')
                    : null;
  const endA     = makeAnchorActivity('end',     end,     endLabel);

  return [startA, ...(day.activities || []), lodgingA, endA].filter(Boolean);
}, [day, trip]);

function coordsEqual(a, b) {
  return a?.lat === b?.lat && a?.lon === b?.lon;
}


const planForUi = useMemo(() => {
  if (!plan || !Array.isArray(plan?.days)) return plan;
  const days = plan.days.map((d, i) => {
    const acts = i === dayIndex ? (uiActivities || []) : (d?.activities || []);
    return { ...d, activities: acts, items: acts }; // items alias’ı
  });
  return { ...plan, days };
}, [plan, dayIndex, uiActivities]);

// UI->Gerçek indeks dönüşümü (baş anchor varsa gerçek indeks = uiIndex - 1)
const hasStartAnchor = uiActivities.length && uiActivities[0]?.meta?.isAnchor;
const hasEndAnchor   = uiActivities.length && uiActivities[uiActivities.length-1]?.meta?.isAnchor;
const uiToReal = useCallback((uiIndex) => {
  if (hasStartAnchor && uiIndex === 0) return null;                    // anchor
  if (hasEndAnchor   && uiIndex === uiActivities.length - 1) return null; // anchor
  return uiIndex - (hasStartAnchor ? 1 : 0);
}, [uiActivities, hasStartAnchor, hasEndAnchor]);

const guardAnchorAction = (uiIndex) => uiToReal(uiIndex) == null; // true ise anchor: sil/değiştir/insert yok


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

  const leftW = isPanelOpen ? LEFT_OPEN_W : LEFT_CLOSED_W;

const markers = useMemo(() => {
  const acts = uiActivities || [];
  return acts.map((a, idx) => {
    const loc = a?.place?.location;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;

    const isAnchor = a?.meta?.isAnchor;
    const kind = a?.meta?.category; // 'start' | 'lodging' | 'end' | undefined

    // Renk ve rozet
    let baseColor = COLORS.accent;
    let orderLabel = String(idx + 1); // default numara
    if (isAnchor && kind === 'start') { baseColor = '#10B981'; orderLabel = 'S'; }
    else if (isAnchor && kind === 'end') { baseColor = '#EF4444'; orderLabel = 'B'; }
    else if (a?.type === 'meal') { baseColor = COLORS.success; }
    else if (a?.type === 'transfer') { baseColor = COLORS.neutral; }

    return {
      activity: a,
      activityId: a.id || String(idx),
      key: a.id || String(idx),
      coordinate: { latitude: loc.lat, longitude: loc.lon },
      title: getActName(a, idx),
      placeId: extractPossiblePlaceIdFromActivity(a),
      baseColor,
      order: orderLabel,     // 🔹 harf de olabilir
      isAnchor,
      kind,
    };
  }).filter(Boolean);
}, [uiActivities]);


  const polylineCoords = useMemo(() => {
    const poly = day?.route?.polyline;
    if (!poly || !poly.length) return null;
    return poly.map(p => ({ latitude: p.lat, longitude: p.lon }));
  }, [day?.route?.polyline]);

  const userCoords = useMemo(() => {
    const m0 = markers?.[0]?.coordinate;
    return m0 || { latitude: 39.93, longitude: 32.86 };
  }, [markers]);

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
    fitToCoords(coords);
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
    const t = setTimeout(fitMapToDay, 120);
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

    // polyline’ı da start→…→end düz çizgiye alın (veya getRouteDirections ile çek)
    const { start, end } = getAnchorsForDayDetailed(trip, d);
    const wps = [];
    if (start) wps.push({ lat:start.lat, lng:start.lon });
    for (const a of d.activities) {
      const l = a?.place?.location;
      if (l) wps.push({ lat:l.lat, lng:l.lon });
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

  /** konaklama + start/end hub’larını çıkar */
function mapLodgingsByDate(trip
) {
   const normalizeDate = (d) => {
    if (!d) return null;
    try {
      return new Date(d).toISOString().split('T')[0];  // 'YYYY-MM-DD'
    } catch {
      return null;
    }
  };
  console.log('mapLodgingsByDate →', mapLodgingsByDate(trip));
  const out = {};
  for (const l of Array.isArray(trip?.lodgings) ? trip.lodgings : []) {
    const dRaw = l?.date || l?.checkIn || l?.check_in || l?.checkInDate || l?.start;
    const d = normalizeDate(dRaw);
    if (!d) continue;

    const lat = Number(l?.location?.lat ?? l?.coords?.lat ?? l?.lat);
    const lng = Number(l?.location?.lng ?? l?.location?.lon ?? l?.coords?.lng ?? l?.coords?.lon ?? l?.lng ?? l?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      out[d] = { location: { lat, lon: lng } };
    }
  }
  return out;
}

  function startEndForDay(tripObj, dday) {
    const byDate = mapLodgingsByDate(tripObj);
    const se = tripObj?._startEndSingle || {};
    const isStartDay = se?.start?.date === dday?.date;
    const isEndDay   = se?.end?.date   === dday?.date;
    const startHub = isStartDay && se?.start?.hub?.location
      ? { lat: se.start.hub.location.lat, lon: se.start.hub.location.lng }
      : null;
    const endHub = isEndDay && se?.end?.hub?.location
      ? { lat: se.end.hub.location.lat,   lon: se.end.hub.location.lng }
      : null;
    const start = startHub || byDate[dday?.date]?.location || null;
    const end   = endHub   || byDate[dday?.date]?.location || null;
    return { start, end };
  }

/** UI’da göstermek için sentetik anchor-activity oluşturur (timeline + marker) */
function makeAnchorActivity(kind, coords, label) {
  if (!coords) return null;
  const id = `anchor:${kind}:${label}:${coords.lat},${coords.lon}`;
  return {
    id,
    type: 'anchor',
    durationMin: 0,
    start: null,
    end: null,
    place: {
      id,
      name: label || (kind === 'start' ? 'Başlangıç' : kind === 'end' ? 'Bitiş' : 'Konaklama'),
      location: { lat: coords.lat, lon: coords.lon },
      category: kind, // 'start' | 'lodging' | 'end'
      address: '',
      photos: [],
    },
    meta: { category: kind, isAnchor: true },
  };
}

  const computeDaySegments = useCallback(async () => {
    const acts = day?.activities || [];
    if ((!acts.length) || !DIRECTIONS_API_KEY) { setSegments([]); return; }

    const nextSegs = [];

    // 0) start → first (opsiyonel)
    const { start, end } = getAnchorsForDayDetailed(trip, day);
    if (start && acts[0]?.place?.location) {
      try {
        const d = await getRouteDirections({
          waypoints:[{ lat:start.lat, lng:start.lon }, buildWaypointFromAct(acts[0])],
          mode:'driving',
          apiKey:DIRECTIONS_API_KEY
        });
        const coords = (d?.polylineCoords || []).map(c => ({ latitude:c.latitude, longitude:c.longitude }));
        if (coords.length >= 2) nextSegs.push({ ok:true, coords });
      } catch {}
    }

    // 1) act → act
    if (acts.length >= 2) {
      for (let i = 0; i < acts.length - 1; i++) {
        const a = acts[i], b = acts[i + 1];
        const w1 = buildWaypointFromAct(a);
        const w2 = buildWaypointFromAct(b);
        const la = a?.place?.location, lb = b?.place?.location;

        if (!w1 || !w2 || !la || !lb) {
          nextSegs.push({ ok:false, coords:[
            { latitude: la?.lat ?? 0, longitude: la?.lon ?? 0 },
            { latitude: lb?.lat ?? 0, longitude: lb?.lon ?? 0 },
          ].filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) });
          continue;
        }
        try {
          const d = await getRouteDirections({ waypoints:[w1,w2], mode:'driving', apiKey:DIRECTIONS_API_KEY });
          const coords = (d?.polylineCoords || []).map(c => ({ latitude:c.latitude, longitude:c.longitude }));
          nextSegs.push(coords.length >= 2 ? { ok:true, coords } : {
            ok:false, coords:[
              { latitude: la.lat, longitude: la.lon },
              { latitude: lb.lat, longitude: lb.lon },
            ]
          });
        } catch {
          nextSegs.push({
            ok:false, coords:[
              { latitude: la.lat, longitude: la.lon },
              { latitude: lb.lat, longitude: lb.lon },
            ]
          });
        }
      }
    }

    // 2) last → end (opsiyonel)
    const last = acts[acts.length - 1];
    if (end && last?.place?.location) {
      try {
        const d = await getRouteDirections({
          waypoints:[buildWaypointFromAct(last), { lat:end.lat, lng:end.lon }],
          mode:'driving',
          apiKey:DIRECTIONS_API_KEY
        });
        const coords = (d?.polylineCoords || []).map(c => ({ latitude:c.latitude, longitude:c.longitude }));
        if (coords.length >= 2) nextSegs.push({ ok:true, coords });
      } catch {}
    }

    setSegments(nextSegs);
  }, [day?.activities, DIRECTIONS_API_KEY, buildWaypointFromAct, trip, day]);

  useEffect(() => {
    if (!day?.activities?.length) { setSegments([]); return; }
    computeDaySegments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayIndex, JSON.stringify(day?.activities || [])]);

  const mutatePlanDays = useCallback((updater) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const next = { ...prev, days: prev.days.map(d => ({ ...d, activities: [...(d.activities || [])] })) };
      updater(next);
      return next;
    });
  }, []);

  const openAddStopAt = useCallback((idx) => {
    setSheetMarker(null);
    setInsertIndex(idx ?? 0);
    setInsertMode(false);
    if (isPanelOpen) setIsPanelOpen(false);
    requestAnimationFrame(() => focusCorridorAround(idx ?? 0));
    setSearchVisible(true);
  }, [isPanelOpen]);

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
            photoUrls: coercePhotoInputsToUrls(det.photos, DIRECTIONS_API_KEY).slice(0, 6),
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
  }, [isSheetOpen, DIRECTIONS_API_KEY]);

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
    setSearchVisible(true);
  }, [isPanelOpen]);

  const handleOverlayCancel = useCallback(() => setSearchVisible(false), []);
  const handleOverlayMapSelect = useCallback(() => {
    setSearchVisible(false);
    const idx = (insertIndex ?? focusIdx ?? 0);
    focusCorridorAround(idx);
  }, [insertIndex, focusIdx]);

  const focusCorridorAround = useCallback((idx) => {
    if (!mapRef.current || !day?.activities?.length) return;
    const arr = day.activities;
    const prev = arr[idx - 1]?.place?.location || null;
    const next = arr[idx]?.place?.location || arr[idx + 1]?.place?.location || null;
    let target = null;
    if (prev && next) target = { latitude: (prev.lat + next.lat) / 2, longitude: (prev.lon + next.lon) / 2 };
    else if (prev)   target = { latitude: prev.lat, longitude: prev.lon };
    else if (next)   target = { latitude: next.lat, longitude: next.lon };
    if (target) {
      try { mapRef.current.animateCamera({ center: target, zoom: 14 }, { duration: 450 }); } catch {}
    }
  }, [day?.activities]);

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
      return;
    }

    if (insertIndex == null) {
      setPendingAdd(sel);
      setInsertMode(true);
      setIsPanelOpen(true);
      return;
    }

    addResolvedAtIndex(insertIndex, sel);
  }, [editIndex, insertIndex, applyReplaceAt, addResolvedAtIndex]);

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
    if (!day?.activities?.length) return;  // 👈 ekle
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
        coercePhotoInputsToUrls(photoRaw, DIRECTIONS_API_KEY),
        2
      );

      if (photoUrls.length === 0 && placeId && isStrictPlaceId(placeId)) {
        const det = await getDetailsWithCache(placeId);
        if (det?.photos?.length) {
          photoUrls = limitPhotos(
            coercePhotoInputsToUrls(det.photos, DIRECTIONS_API_KEY),
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
  }, [day, dayIndex, isPanelOpen, DIRECTIONS_API_KEY]);

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

  /** ✅ Cihaz konumunu güvenli şekilde al */
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

  const { start } = getAnchorsForDayDetailed(trip, day);
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
}, [day, trip, DIRECTIONS_API_KEY, buildWaypointFromAct, fitToCoords]);

const pickLegToEndAnchor = useCallback(async () => {
  const acts = day?.activities || [];
  if (!acts.length || !DIRECTIONS_API_KEY) return;

  const { end } = getAnchorsForDayDetailed(trip, day);
  const last = acts[acts.length - 1];
  if (!end || !last?.place?.location) return;

  setLegSel({ from: acts.length - 1, to: acts.length }); // last → end
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
}, [day, trip, DIRECTIONS_API_KEY, buildWaypointFromAct, fitToCoords]);

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
          {(plan?.days || []).map((d, i) => {
            const active = i === dayIndex;
            return (
              <Pressable
                key={d.date || i}
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
            );
          })}
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
<SideTimeline
  isOpen={isPanelOpen}
  plan={planForUi}                    // 👈 değişti
  dayIndex={dayIndex}
  setDayIndex={setDayIndex}
onSelect={(payload) => {
        if (payload && payload.anchor) {
          if (payload.anchor === 'start' && day?.activities?.length) focusActivity({ index: 0, source: 'timeline' });
          if (payload.anchor === 'end' && day?.activities?.length) focusActivity({ index: day.activities.length - 1, source: 'timeline' });
          return;
        }
        const uiIdx = typeof payload === 'object' ? payload.index : payload;  // Anchor’a tıklanırsa: gün boş olabilir → guard
  if (guardAnchorAction(uiIdx)) {
    if ((day?.activities || []).length > 0) {
      // Anchor → ilk gerçek durağı fokusla
      focusActivity(0);
    } else {
      // o gün hiç aktivite yoksa sadece haritayı konaklamaya fit edebilirsin (opsiyonel)
    }
    return;
  }
  const real = uiToReal(uiIdx);
  if (real != null) focusActivity(real);
}}

  onInsertAt={(uiIdx) => {
    if (guardAnchorAction(uiIdx)) return;       // anchor arası insert yok
    openAddStopAt(uiToReal(uiIdx));             // gerçek indekse insert
  }}
  onEditAt={(uiIdx) => {
    if (guardAnchorAction(uiIdx)) return;       // anchor edit yok
    startEditAt(uiToReal(uiIdx));
  }}
  onDeleteAt={(uiIdx) => {
    if (guardAnchorAction(uiIdx)) return;       // anchor silme yok
    handleDeleteAt(uiToReal(uiIdx));
  }}
  onReorder={(fromUi, toUi) => {
    // anchor’ların üstünden/üstüne sürüklemeyi engelle
    if (guardAnchorAction(fromUi) || guardAnchorAction(toUi)) return;
    handleReorder(uiToReal(fromUi), uiToReal(toUi));
  }}
  insertMode={insertMode}
  onPickInsertIndex={(uiIdx) => {
    if (guardAnchorAction(uiIdx)) return;
    const real = uiToReal(uiIdx);
    if (pendingAdd) addResolvedAtIndex(real, pendingAdd);
    setPendingAdd(null);
    setInsertMode(false);
    setInsertIndex(null);
  }}
  onCancelInsertMode={() => {
    setPendingAdd(null);
    setInsertMode(false);
    setInsertIndex(null);
  }}
  onPickLeg={(uiFrom) => {
   // Başlangıç(anchor) → ilk gerçek durak
   if (hasStartAnchor && uiFrom === 0) {
     pickLegFromStartAnchor();
     return;
   }
   // Son durak → bitiş(anchor) (opsiyonel: istersen aktif et)
   if (hasEndAnchor && uiFrom === uiActivities.length - 2) {
     pickLegToEndAnchor();
     return;
   }
   if (guardAnchorAction(uiFrom) || guardAnchorAction(uiFrom + 1)) return;
   pickLeg(uiToReal(uiFrom));
  }}
    startAnchor={anchorInfo.start ? { label: anchorInfo.startLabel, location: anchorInfo.start } : null}
  endAnchor={anchorInfo.end ? { label: anchorInfo.endLabel, location: anchorInfo.end } : null}
  lodgingAnchor={anchorInfo.lodge ? { label: 'Konaklama', location: anchorInfo.lodge } : null}
/>

        </View>

        {/* Orta toggle */}
        <View style={styles.toggleOverlay} pointerEvents="box-none">
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
            initialRegion={{
              latitude:  markers?.[0]?.coordinate?.latitude  || 39.93,
              longitude: markers?.[0]?.coordinate?.longitude || 32.86,
              latitudeDelta: 0.15,
              longitudeDelta: 0.15,
            }}
          >
            {/* Seçili leg varsa onu, yoksa günlük çizgiler */}
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
                     // Segmente tıklanınca önizleme için tüm günü birleştir (hafifçe)
                     const merged = { polylineCoords: s.coords };
                     setRouteData(merged);
                     setRouteSheetOpen(true);
                   }}                  zIndex={0}
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
                      coercePhotoInputsToUrls(photoRaw, DIRECTIONS_API_KEY),
                      2
                    );

                    if (!isStrictPlaceId(m.placeId)) {
                      const pid = await resolvePlaceIdByCoordsAndName({
                        name: m.title,
                        coords: { latitude: m.coordinate.latitude, longitude: m.coordinate.longitude },
                        apiKey: DIRECTIONS_API_KEY,
                      });
                      if (pid) m.placeId = pid;
                    }

                    if (photoUrls.length === 0 && isStrictPlaceId(m.placeId)) {
                      try {
                        const det = await getDetailsWithCache(m.placeId);
                        if (det?.photos?.length) {
                          photoUrls = limitPhotos(
                            coercePhotoInputsToUrls(det.photos, DIRECTIONS_API_KEY),
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

      {/* Search overlay */}
      {searchVisible && (
        <GetDirectionsOverlay
          userCoords={userCoords}
          onToSelected={sel => presentDetailsForSelection(sel)}
          available={false}
          refreshLocation={() => {}}
          onCancel={handleOverlayCancel}
          onMapSelect={handleOverlayMapSelect}
          historyKey="search_history_stops"
        />
      )}

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

      {/* Route Sheet — önizleme iki durak arası */}
      <TripRouteSheet
        visible={routeSheetOpen}
        waypoints={legWaypoints}
        apiKey={DIRECTIONS_API_KEY}
        preferredMode="driving"
        previewData={routeData}
        previewTitle={
          (legActs?.a && legActs?.b)
            ? `${getActName(legActs.a, legSel?.from ?? 0)} → ${getActName(legActs.b, legSel?.to ?? 0)}`
            : undefined
        }
        onClose={() => {
          setRouteSheetOpen(false);
          setRouteData(null);
          setIsPanelOpen(true);
        }}
        onStart={async (mode) => {
          const ok = await ensureLocationBeforeStart();
          if (!ok) return;
          setRouteSheetOpen(false);

          try {
            const b = legActs?.b; // hedef
            const a = legActs?.a; // önceki durak
            if (!b?.place?.location) return;

            // 1) Cihaz konumu
            const cur = await getCurrentDeviceLatLng();
            if (!cur) { Alert.alert('Konum', 'Mevcut konum alınamadı.'); return; }

            const la = { lat: cur.lat, lon: cur.lng }; // from = cihaz
            const lb = b.place.location;               // to   = hedef

            // 2) Taze rota
            let navRoute = null;
            try {
              navRoute = await getRouteDirections({
                waypoints: [{ lat: la.lat, lng: la.lon }, { lat: lb.lat, lng: lb.lon }],
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

              // cihaz konumu (marker yok, OS mavi nokta var)
              from: { latitude: la.lat, longitude: la.lon, name: 'Mevcut Konum', place_id: null },

              // hedef
              to:   { latitude: lb.lat, longitude: lb.lon, name: nameB, place_id: pidB },

              // önceki durak marker’ı (siyah)
              prevStop: a?.place?.location
                ? { latitude: a.place.location.lat, longitude: a.place.location.lon, order: (legSel?.from ?? 0) + 1, name: nameA }
                : null,

              // hedef durak marker’ı (kırmızı) → NavigationScreen dest marker’ı için sıra no
              nextStop: { latitude: lb.lat, longitude: lb.lon, order: destOrderNum, name: nameB },

              waypoints: [{ lat: la.lat, lng: la.lon }, { lat: lb.lat, lng: lb.lon }],
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
    backgroundColor: COLORS.bgCard,
    borderRightWidth: 0,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },

  toggleOverlay: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    justifyContent: 'center',
    zIndex: 999,
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

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0D12' },
});
