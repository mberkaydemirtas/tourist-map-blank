// trips/screens/TripPlansScreen.js
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Dimensions, ActivityIndicator, Alert,
  BackHandler, LayoutAnimation, Platform, UIManager, ScrollView, TouchableOpacity
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SideTimeline from '../components/SideTimeline';
import GetDirectionsOverlay from '../../map/components/GetDirectionsOverlay';
import PlaceQuickCard from '../../map/components/PlaceQuickCard';

import { generatePlan } from '../services/planService';
import { getTripLocal, patchTripLocal } from '../../app/lib/tripsLocal';
import { getPlanByTripId, savePlan } from '../shared/plansRepo';
import { formatDate } from '../shared/types';
import { resolvePlacesBatch } from '../services/placeResolver';
import { getPlaceDetails } from '../../map/maps';

const { width: SCREEN_W } = Dimensions.get('window');

/* ====== THEME ====== */
const COLORS = {
  bgApp: '#F3F4F6',
  bgCard: '#FFFFFF',
  border: '#E5E7EB',
  fg: '#111827',
  fgMuted: '#6B7280',
  primary: '#111827',         // koyu butonlar
  accent: '#2563EB',          // rota/aktif gün vurgusu
  accentDim: '#EFF6FF',
  warnSoftBg: '#FFF6ED',
  warnSoftBorder: '#FBD6B6',
  success: '#4CAF50',
  neutral: '#607D8B',
};

const LEFT_OPEN_W = Math.min(380, SCREEN_W * 0.42);
const LEFT_CLOSED_W = 0;
const TOGGLE_PEEK = 12;   // kenardan hafif taşma
const TOGGLE_SIZE = 44;   // tam daire

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ---------------- helpers ---------------- */
const round5k = (x) => Math.round(Number(x) * 1e5) / 1e5;
const keyOf = (x) => {
  const lat = Number(x?.lat ?? x?.coords?.lat);
  const lon = Number(x?.lon ?? x?.coords?.lng ?? x?.coords?.lon);
  const nm  = String(x?.name || '').trim().toLowerCase();
  return `${nm}@${round5k(lat)},${round5k(lon)}`;
};

function isValidPlaceId(pid) {
  if (typeof pid !== 'string') return false;
  if (pid.includes(':')) return false; // tmp:, map: vs.
  if (pid.length < 20) return false;
  if (!/^Ch|^Gh|^[A-Za-z0-9_-]{20,}$/.test(pid)) return false;
  return true;
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
  try { batch = await resolvePlacesBatch({ items: unresolved, city }); } catch { return trip; }

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

/* -------- getPlaceDetails cache (foto destekli) -------- */
const detailsCache = new Map();
async function getDetailsWithCache(placeId) {
  if (!placeId || !isValidPlaceId(placeId)) return null;
  const cached = detailsCache.get(placeId);
  if (cached && Date.now() - cached.ts < 1000 * 60 * 30) return cached;
  const det = await getPlaceDetails(placeId);
  let photos = [];
  if (Array.isArray(det?.photos)) {
    photos = det.photos
      .map((p) => (typeof p === 'string' ? p : (p?.url || p?.uri)))
      .filter(Boolean);
  }
  const norm = det ? { coords: det.coords, name: det.name, address: det.address, photos, ts: Date.now() } : null;
  if (norm) detailsCache.set(placeId, norm);
  return norm;
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

export default function TripPlansScreen({ route, navigation }) {
  const { tripId } = route.params || {};
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [trip, setTrip] = useState(null);
  const [plan, setPlan] = useState(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  // map & focus
  const mapRef = useRef(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [selectedActId, setSelectedActId] = useState(null);
  const markerRefs = useRef({});
  const setMarkerRef = useCallback((id, ref) => { if (id) markerRefs.current[id] = ref; }, []);

  // search & map-pick
  const [searchVisible, setSearchVisible] = useState(false);
  const [insertIndex, setInsertIndex] = useState(null);

  // “nereye eklemek istersin?” modu
  const [insertMode, setInsertMode] = useState(false);
  const [pendingAdd, setPendingAdd] = useState(null);

  // QuickCard
  const [sheetMarker, setSheetMarker] = useState(null);
  const [sheetVariant, setSheetVariant] = useState('add'); // 'add' | 'preview'
  const [sheetMeta, setSheetMeta] = useState('');          // Gün/Sıra etiketi
  const isSheetOpen = !!sheetMarker;

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

  /* ====== Haritada seçim akışları ====== */

  // POI’ye dokunma → ADD kartı (foto varsa getir)
  const handlePoiClick = useCallback(async (e) => {
    const { coordinate, name, placeId } = e.nativeEvent || {};
    if (!coordinate) return;

    setIsPanelOpen(false);

    let photoUrls = [];
    try {
      if (isValidPlaceId(placeId)) {
        const det = await getDetailsWithCache(placeId);
        if (det?.photos?.length) photoUrls = det.photos.slice(0, 2);
      }
    } catch {}

    setSheetVariant('add');
    setSheetMeta('');
    setSheetMarker({
      name: name || 'Seçilen yer',
      address: '',
      coords: { latitude: coordinate.latitude, longitude: coordinate.longitude },
      place_id: isValidPlaceId(placeId) ? placeId : null,
      photoUrls,
    });
  }, []);

  // Uzun bas → serbest nokta → ADD kartı
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

  const day = useMemo(() => plan?.days?.[dayIndex] || null, [plan, dayIndex]);

  // Toggle: kart varsa kapat, paneli aç; insert mode varsa iptal et
  const onTogglePanel = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (isSheetOpen) setSheetMarker(null); // kartı kapat
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
    if (!day) return [];
    const acts = (day.activities || [])
      .filter(a => a?.place?.location && Number.isFinite(a.place.location.lat) && Number.isFinite(a.place.location.lon));
    return acts.map((a, idx) => ({
      activity: a,
      activityId: a.id || String(idx),
      key: a.id || String(idx),
      coordinate: { latitude: a.place.location.lat, longitude: a.place.location.lon },
      title: getActName(a, idx),
      placeId: a.place?.place_id || null,
      baseColor: a.type === 'meal' ? COLORS.success : (a.type === 'transfer' ? COLORS.neutral : COLORS.accent),
      order: idx + 1,
    }));
  }, [day?.activities]);

  const polylineCoords = useMemo(() => {
    const poly = day?.route?.polyline;
    if (!poly || !poly.length) return null;
    return poly.map(p => ({ latitude: p.lat, longitude: p.lon }));
  }, [day?.route?.polyline]);

  const userCoords = useMemo(() => {
    const m0 = markers?.[0]?.coordinate;
    return m0 || { latitude: 39.93, longitude: 32.86 };
  }, [markers]);

  const fitMapToDay = useCallback(() => {
    if (!mapRef.current) return;
    const coords = polylineCoords?.length ? polylineCoords : markers.map(m => m.coordinate);
    if (!coords || !coords.length) return;
    try {
      mapRef.current.fitToCoordinates(coords, { edgePadding: { top: 80, right: 80, bottom: 80, left: 80 }, animated: true });
    } catch {}
  }, [polylineCoords, markers]);

  useEffect(() => {
    setFocusIdx(0);
    setSelectedActId(null);
    markerRefs.current = {};
    const t = setTimeout(fitMapToDay, 120);
    return () => clearTimeout(t);
  }, [dayIndex, fitMapToDay]);

  const showMarkerCallout = useCallback((activityId) => {
    const ref = markerRefs.current[activityId];
    if (ref && typeof ref.showCallout === 'function') {
      setTimeout(() => { try { ref.showCallout(); } catch {} }, 50);
    }
  }, []);

  // ❗ SideTimeline’dan seçim → SADECE yakınlaştır (kart açma)
  const focusActivity = useCallback((activity) => {
    if (!activity || !mapRef.current) return;
    const loc = activity?.place?.location;
    if (loc?.lat == null || loc?.lon == null) return;

    const id = activity.id || null;
    const idx = (day?.activities || []).findIndex(a => (a.id || '') === (activity.id || ''));
    if (idx >= 0) setFocusIdx(idx);
    setSelectedActId(id);

    mapRef.current.animateCamera({
      center: { latitude: loc.lat, longitude: loc.lon },
      zoom: 15, pitch: 0, heading: 0,
    }, { duration: 500 });

    if (id) showMarkerCallout(id);
  }, [day?.activities, showMarkerCallout]);

  /* ---------- zaman & polyline ---------- */
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

  const mutatePlanDays = useCallback((updater) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const next = { ...prev, days: prev.days.map(d => ({ ...d, activities: [...(d.activities || [])] })) };
      updater(next);
      return next;
    });
  }, []);

  /* ---------- Add/Replace flow ---------- */
  const openAddStopAt = useCallback((idx) => {
    setSheetMarker(null);
    setInsertIndex(idx ?? 0);
    setInsertMode(false);
    if (isPanelOpen) setIsPanelOpen(false);
   // ekleme aralığını göster
   requestAnimationFrame(() => focusCorridorAround(idx ?? 0));
   setSearchVisible(true);  }, [isPanelOpen]);

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

  // Search/POI/Map select → QuickCard (add)
  const presentDetailsForSelection = useCallback(async (sel) => {
    if (isSheetOpen) setSheetMarker(null);

    let resolved = sel;
    if (!resolved?.coords && sel?.key) {
      try {
        if (isValidPlaceId(sel.key)) {
          const det = await getDetailsWithCache(sel.key);
          if (det?.coords) {
            resolved = {
              key: sel.key,
              description: det.name || sel.description,
              coords: det.coords,
              address: det.address,
              photoUrls: (det.photos || []).slice(0, 2),
            };
          }
        }
      } catch {}
    }
    setSearchVisible(false);
    if (resolved?.coords) {
      setIsPanelOpen(false);
         // seçilen noktaya yakınlaş
    try {
      mapRef.current?.animateCamera(
        { center: { latitude: resolved.coords.latitude, longitude: resolved.coords.longitude }, zoom: 15 },
        { duration: 450 }
      );
    } catch {}
      setSheetVariant('add');
      setSheetMeta('');
      setSheetMarker({
        name: resolved.description,
        address: resolved.address,
        coords: resolved.coords,
        place_id: isValidPlaceId(resolved.key) ? resolved.key : null,
        photoUrls: resolved.photoUrls || [],
      });
    }
  }, [isSheetOpen]);

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
    setInsertIndex(index); // replace hedefi
    if (isPanelOpen) setIsPanelOpen(false);
    setSearchVisible(true);
  }, [isPanelOpen]);

  const handleOverlayCancel = useCallback(() => setSearchVisible(false), []);
  const handleOverlayMapSelect = useCallback(() => {
    setSearchVisible(false);
    // ekleme hedefi biliniyorsa, o aralıktaki koridora odaklan
    const idx = (insertIndex ?? focusIdx ?? 0);
    focusCorridorAround(idx);  }, []);

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
      try {
        mapRef.current.animateCamera({ center: target, zoom: 14 }, { duration: 450 });
      } catch {}
    }
  }, [day?.activities]);

  // QuickCard CTA (sadece add modunda görünür)
  const handleQuickCardCta = useCallback((markerLike) => {
    const c = markerLike?.coords;
    const sel = {
      key: markerLike?.place_id || `map:${Math.round((c?.latitude ?? 0) * 1e6)}_${Math.round((c?.longitude ?? 0) * 1e6)}`,
      description: markerLike?.name || 'Seçilen konum',
      coords: c,
      address: markerLike?.address || ''
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
      setIsPanelOpen(true); // kullanıcıdan nereye ekleyeceğini seçmesini iste
      return;
    }

    addResolvedAtIndex(insertIndex, sel);
  }, [editIndex, insertIndex, applyReplaceAt, addResolvedAtIndex]);

  /* ---------- Delete ---------- */
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

  /* ---------- Reorder (drag) ---------- */
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

  // Header meta
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ color: '#ddd', marginTop: 8 }}>Plan hazırlanıyor…</Text>
      </View>
    );
  }
  if (!trip || !plan) {
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
          {plan.days.map((d, i) => {
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
            plan={plan}
            dayIndex={dayIndex}
            setDayIndex={setDayIndex}
            onSelect={focusActivity}
            selectedActivityId={selectedActId}
            onInsertAt={openAddStopAt}
            onEditAt={startEditAt}
            onDeleteAt={handleDeleteAt}
            onReorder={handleReorder}
            insertMode={insertMode}
            onPickInsertIndex={(idx) => {
              if (pendingAdd) addResolvedAtIndex(idx, pendingAdd);
              setPendingAdd(null);
              setInsertMode(false);
              setInsertIndex(null);
            }}
            onCancelInsertMode={() => {
              setPendingAdd(null);
              setInsertMode(false);
              setInsertIndex(null);
            }}
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
            <Pressable onPress={onTogglePanel} style={styles.panelToggle} hitSlop={8} accessibilityLabel="Paneli Aç/Kapat">
              <Ionicons name={isPanelOpen ? 'chevron-back' : 'chevron-forward'} size={18} color="#000" />
            </Pressable>
          </View>
        </View>

        {/* Harita */}
        <View style={[styles.mapWrap, { width: SCREEN_W - (isPanelOpen ? LEFT_OPEN_W : LEFT_CLOSED_W) }]}>
          <MapView
            ref={mapRef}
            style={styles.map}
            pointerEvents="auto"               // ❗ her zaman aktif
            showsPointsOfInterest={true}
            onPoiClick={handlePoiClick}        // POI seçimi
            onLongPress={handleMapLongPress}   // uzun basarak serbest seçim
            initialRegion={{
              latitude:  markers?.[0]?.coordinate?.latitude  || 39.93,
              longitude: markers?.[0]?.coordinate?.longitude || 32.86,
              latitudeDelta: 0.15,
              longitudeDelta: 0.15,
            }}
          >
            {polylineCoords && <Polyline coordinates={polylineCoords} strokeWidth={5} />}

            {/* QuickCard’ın seçtiği nokta için geçici pin istersen buraya eklenebilir */}

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
                  onPress={async () => {
                    setSelectedActId(m.activityId);
                    setIsPanelOpen(false);
                    let photoUrls = [];
                    try {
                      if (isValidPlaceId(m.placeId)) {
                        const det = await getDetailsWithCache(m.placeId);
                        if (det?.photos?.length) photoUrls = det.photos.slice(0, 2);
                      }
                    } catch {}
                    // Marker → PREVIEW kart
                    setSheetVariant('preview');
                    setSheetMeta(`Gün ${dayIndex + 1} • Sıra ${m.order}`);
                    setSheetMarker({
                      name: m.title || 'Seçilen konum',
                      address: '',
                      coords: { latitude: m.coordinate.latitude, longitude: m.coordinate.longitude },
                      place_id: isValidPlaceId(m.placeId) ? m.placeId : null,
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
    zIndex: 180,
    elevation: 6,
  },
  panelToggleWrapper: {
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -TOGGLE_SIZE / 2 }],
  },
  panelToggle: {
    position: 'absolute',
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
    overflow: 'visible',
    left: 0,
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
