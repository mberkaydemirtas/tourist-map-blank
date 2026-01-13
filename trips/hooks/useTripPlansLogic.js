// trips/hooks/useTripPlansLogic.js
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Alert, LayoutAnimation, Platform, UIManager } from 'react-native';
import Constants from 'expo-constants';
import { useFocusEffect } from '@react-navigation/native';

// Core hooks
import { useTripAndPlan } from './parts/useTripAndPlan';
import { useTripSegments } from './parts/useTripSegments';
import { useTripRouteSheet } from './parts/useTripRouteSheet';
import { useTripSearch } from './parts/useTripSearch';
import { useTripAnchors } from './parts/useTripAnchors';
import { useTripLocationGuard } from './parts/useTripLocationGuard';

// Servisler
import { optimizeDayWithAnchors } from '../services/dayOptimizer';
import { getAnchorsForDayDetailed } from '../shared/anchors';

// Renkler
import { COLORS } from '../components/TripPlanStyles';

// Helperlar
import {
  uid,
  toISODateSafe,
  addDaysISO,
  getActName,
  extractPossiblePlaceIdFromActivity,
} from '../components/TripPlanHelpers';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const DIRECTIONS_API_KEY =
  Constants?.expoConfig?.extra?.GOOGLE_MAPS_API_KEY ||
  Constants?.manifest?.extra?.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  global?.GOOGLE_MAPS_API_KEY ||
  '';

const makeEmptyPlan = (tripId) => {
  const todayISO = new Date().toISOString().slice(0, 10);
  return {
    _id: `plan_${tripId}`,
    id: `plan_${tripId}`,
    tripId,
    days: [{ id: uid(), date: todayISO, activities: [] }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'scratch',
  };
};

/**
 * ✅ coords normalize:
 * - { coords: { latitude, longitude } }
 * - { coords: { lat, lng } }
 * - { coords: { lat, lon } }
 */
function normalizeResolvedCoords(resolved) {
  const c = resolved?.coords;
  if (!c) return null;

  const lat =
    c.latitude ?? c.lat ?? c.lattitude ?? resolved?.latitude ?? resolved?.lat;

  const lng =
    c.longitude ??
    c.lng ??
    c.lon ??
    resolved?.longitude ??
    resolved?.lng ??
    resolved?.lon;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * ✅ Trip.selectedPlaces / Trip.places → resolvedLike dönüşümü
 * Beklenen selectedPlace şekli (TripListQuestion):
 * {
 *   id, name, address,
 *   coords: { lat, lng }  (veya { latitude, longitude }),
 *   category, place_id, city
 * }
 */
function selectedPlaceToResolvedLike(sp) {
  // sp şu şekillerde gelebiliyor:
  // 1) sp.coords: { lat,lng } / { lat,lon } / { latitude,longitude }
  // 2) sp: { lat, lon } (coords yok)
  // 3) sp.location: { lat,lng } gibi
  const c = sp?.coords || sp?.location || sp?.place?.location || null;

  const lat =
    c?.latitude ?? c?.lat ?? sp?.lat ?? sp?.latitude ?? null;

  const lng =
    c?.longitude ??
    c?.lng ??
    c?.lon ??
    sp?.lon ??
    sp?.lng ??
    sp?.longitude ??
    null;

  return {
    key: sp?.place_id || sp?.id || `sel:${Date.now()}`,
    description: sp?.name || sp?.address || 'Seçilen yer',
    coords:
      Number.isFinite(lat) && Number.isFinite(lng)
        ? { latitude: lat, longitude: lng }
        : null,
    address: sp?.address || '',
    photoUrls: Array.isArray(sp?.photoUrls) ? sp.photoUrls : [],
    photos: Array.isArray(sp?.photos) ? sp.photos : [],
    category: sp?.category || 'sights',
    city: sp?.city || '',
    place_id: sp?.place_id || null,
  };
}


export function useTripPlansLogic({ tripId, navigation, route }) {
  /* ------------ STATE ------------ */

  const [isPanelOpen, setIsPanelOpen] = useState(true);

  const mapRef = useRef(null);
  const currentMapCenter = useRef(null);
  const [selectedActId, setSelectedActId] = useState(null);
  const markerRefs = useRef({});
  const [focusIdx, setFocusIdx] = useState(0);
  const lastMarkerPressRef = useRef(0);

  const [datePickOpen, setDatePickOpen] = useState(false);
  const [datePickIndex, setDatePickIndex] = useState(null);
  const [datePickValue, setDatePickValue] = useState(new Date());

  /* ------------ Sabit tercih profili ------------ */

  const prefs = useMemo(
    () => ({
      dayStart: '09:30',
      dayEnd: '20:00',
      lunchAround: '13:00',
      dinnerAround: '19:00',
      defaultDurations: {
        museum: 90,
        sights: 45,
        restaurants: 60,
        cafes: 40,
        parks: 40,
        bars: 75,
      },
      tempo: 'normal',
      travelMode: 'driving',
      mealSearchRadiusMeters: 1200,
      minRating: 4.2,
    }),
    []
  );

  /* ------------ Trip & Plan core hook ------------ */

  const { loading, trip, setTrip, plan, setPlan, dayIndex, setDayIndex, day } =
    useTripAndPlan({ tripId, navigation, route, prefs });

  /* ------------ Anchors + UI Activities (Hook) ------------ */

  const { anchorInfo, uiActivities, uiToReal, guardAnchorAction } =
    useTripAnchors({
      trip,
      day,
      plan,
      dayIndex,
    });

  /* ------------ Segment & fit hook ------------ */

  const { segments, fitMapToDay } = useTripSegments({
    day,
    uiActivities,
    mapRef,
  });

  /**
   * ✅ KRİTİK FIX:
   * fitMapToDay fonksiyonu her render’da değişebiliyorsa effect sürekli tetiklenir ve render loop yapar.
   * Bu yüzden fitMapToDay’i ref’te tutup effect’i sadece dayIndex’e bağladık.
   */
  const fitMapToDayRef = useRef(fitMapToDay);
  useEffect(() => {
    fitMapToDayRef.current = fitMapToDay;
  }, [fitMapToDay]);

  /* ------------ Route Sheet hook ------------ */

  const {
    routeData,
    setRouteData,
    routeSheetOpen,
    setRouteSheetOpen,
    legSel,
    setLegSel,
    legActs,
    setLegActs,
    legWaypoints,
    setLegWaypoints,
    routeLegLabel,
    setRouteLegLabel,
    pickLeg,
    onPickLegPair,
  } = useTripRouteSheet({
    day,
    mapRef,
    uiToReal,
    setIsPanelOpen,
  });

  /* ------------ Konum İzni / GPS Guard hook ------------ */

  const { permissionPrompt, setPermissionPrompt, ensureLocationBeforeStart } =
    useTripLocationGuard();

  /* ------------ Plan / gün mutate helperları ------------ */

  const resequenceAllDays = useCallback(
    (baseIndex) => {
      setPlan((prev) => {
        if (!prev?.days?.length) return prev;
        const next = { ...prev, days: prev.days.map((d) => ({ ...d })) };

        if (!next.days.some((d) => d?.date)) {
          const startISO = toISODateSafe(new Date());
          next.days.forEach((d, i) => {
            d.date = addDaysISO(startISO, i);
          });
          return { ...next, updatedAt: new Date().toISOString() };
        }

        let anchor = baseIndex;
        if (anchor == null || !next.days[anchor]?.date) {
          anchor = next.days.findIndex((d) => !!d?.date);
          if (anchor < 0) anchor = 0;
          if (!next.days[anchor]?.date)
            next.days[anchor].date = toISODateSafe(new Date());
        }

        const anchorISO = toISODateSafe(next.days[anchor].date);
        for (let i = anchor - 1; i >= 0; i--)
          next.days[i].date = addDaysISO(anchorISO, i - anchor);
        for (let i = anchor + 1; i < next.days.length; i++)
          next.days[i].date = addDaysISO(anchorISO, i - anchor);

        return { ...next, updatedAt: new Date().toISOString() };
      });
    },
    [setPlan]
  );

  const mutatePlanDays = useCallback(
    (updater) => {
      setPlan((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          days: (prev.days || [])
            .filter(Boolean)
            .map((d) => ({ ...d, activities: [...(d.activities || [])] })),
        };
        updater(next);
        return { ...next, updatedAt: new Date().toISOString() };
      });
    },
    [setPlan]
  );

  const retimeDay = useCallback((d) => {
    let curMin = 9 * 60 + 30;
    d.activities.forEach((a) => {
      const hh = String(Math.floor(curMin / 60)).padStart(2, '0');
      const mm = String(curMin % 60).padStart(2, '0');
      a.start = `${hh}:${mm}`;
      curMin += a.durationMin || 45;
      const hh2 = String(Math.floor(curMin / 60)).padStart(2, '0');
      const mm2 = String(curMin % 60).padStart(2, '0');
      a.end = `${hh2}:${mm2}`;
    });
  }, []);

  const rebuildPolyline = useCallback((d) => {
    const pts = [];
    d.activities.forEach((a) => {
      const loc = a?.place?.location;
      if (loc) pts.push({ lat: loc.lat, lon: loc.lon });
    });
    d.route = { ...(d.route || {}), polyline: pts, optimizerUsed: false };
  }, []);

  const reoptimizeCurrentDay = useCallback(() => {
    mutatePlanDays((next) => {
      const d = next.days?.[dayIndex];
      if (!d) return;
      retimeDay(d);
      rebuildPolyline(d);
    });
  }, [mutatePlanDays, dayIndex, retimeDay, rebuildPolyline]);

  /**
   * ✅ addResolvedAtIndex artık hem {latitude,longitude} hem {lat,lng} kabul eder.
   */
  const addResolvedAtIndex = useCallback(
    (idx, resolved) => {
      if (!resolved) return;

      const coords = normalizeResolvedCoords(resolved);
      if (!coords) {
        console.warn('[TripPlans] incoming place has no valid coords:', resolved);
        return;
      }

      const id = resolved.key || `tmp:${Date.now()}`;
      const category = resolved?.category || 'sights';

      const act = {
        id,
        type: 'visit',
        durationMin: 45,
        place: {
          id,
          name: resolved.description || 'Seçilen yer',
          location: { lat: coords.latitude, lon: coords.longitude },
          category,
          address: resolved.address || '',
          photos: Array.isArray(resolved.photoUrls)
            ? resolved.photoUrls.map((u) => ({ url: u }))
            : undefined,
        },
        meta: {
          category,
          googlePlaceId: resolved?.place_id || null,
          place_id: resolved?.place_id || null,
          source: 'selectedPlaces',
        },
      };

      mutatePlanDays((next) => {
        const d = next.days?.[dayIndex];
        if (!d) return;
        const pos = Math.min(Math.max(idx ?? 0, 0), d.activities.length);
        d.activities.splice(pos, 0, act);
        retimeDay(d);
        rebuildPolyline(d);
      });
    },
    [dayIndex, mutatePlanDays, retimeDay, rebuildPolyline]
  );

  const optimizeCurrentDay = useCallback(() => {
    mutatePlanDays((next) => {
      const d = next.days?.[dayIndex];
      if (!d) return;

      const ordered = optimizeDayWithAnchors(d, trip, getAnchorsForDayDetailed);
      d.activities = ordered;
      retimeDay(d);

      const { start, end, lodge } = getAnchorsForDayDetailed(trip, d);
      const wps = [];
      if (start) wps.push({ lat: start.lat, lng: start.lon ?? start.lng });
      d.activities.forEach((a) => {
        const l = a?.place?.location;
        if (l) wps.push({ lat: l.lat, lng: l.lon ?? l.lng });
      });
      if (lodge && (!end || lodge.lat !== end.lat))
        wps.push({ lat: lodge.lat, lng: lodge.lon ?? lodge.lng });
      if (end) wps.push({ lat: end.lat, lng: end.lon ?? end.lng });

      d.route = {
        ...(d.route || {}),
        polyline: wps.map((p) => ({ lat: p.lat, lon: p.lng })),
        optimizerUsed: true,
      };
    });
  }, [mutatePlanDays, dayIndex, trip, retimeDay]);

  const deleteDayAt = useCallback(
    (idx) => {
      mutatePlanDays((next) => {
        if (next.days.length <= 1) {
          Alert.alert('Uyarı', 'En az bir gün olmalı.');
          return;
        }
        next.days.splice(idx, 1);
        setDayIndex((cur) => Math.min(cur, next.days.length - 1));
      });
      requestAnimationFrame(() => resequenceAllDays(Math.max(0, idx - 1)));
    },
    [mutatePlanDays, resequenceAllDays, setDayIndex]
  );

  const addEmptyDay = useCallback(() => {
    mutatePlanDays((next) => {
      const lastISO = next.days.length
        ? toISODateSafe(next.days[next.days.length - 1].date)
        : toISODateSafe(new Date());
      const newISO = addDaysISO(lastISO, 1);
      next.days.push({ id: uid(), date: newISO, activities: [] });
    });
    requestAnimationFrame(() => resequenceAllDays(null));
  }, [mutatePlanDays, resequenceAllDays]);

  const setDayDateAt = useCallback(
    (idx, dateObjOrISO) => {
      const iso =
        typeof dateObjOrISO === 'string'
          ? dateObjOrISO
          : toISODateSafe(dateObjOrISO);
      if (!iso) return;

      setPlan((prev) => {
        if (!prev) return prev;
        const arr = [...(prev.days || [])];
        if (!arr[idx]) return prev;
        arr[idx] = { ...arr[idx], date: iso };
        return { ...prev, days: arr, updatedAt: new Date().toISOString() };
      });

      requestAnimationFrame(() => resequenceAllDays(idx));
    },
    [setPlan, resequenceAllDays]
  );

  /* ---------------------------------------------------------
   * ✅ TripPlacesScreen -> TripPlansScreen place transfer FIX
   * --------------------------------------------------------- */
  const lastIncomingKeyRef = useRef(null);

  useFocusEffect(
    useCallback(() => {
      const incoming = route?.params?.__TP_INCOMING_PLACE;
      if (!incoming) return;

      const k = incoming?.key || null;
      if (k && lastIncomingKeyRef.current === k) return;
      if (k) lastIncomingKeyRef.current = k;

      const ins =
        typeof incoming?.insertIndex === 'number' ? incoming.insertIndex : null;
      addResolvedAtIndex(ins ?? (day?.activities?.length || 0), incoming);

      try {
        navigation?.setParams?.({ __TP_INCOMING_PLACE: undefined });
      } catch {}
    }, [
      route?.params?.__TP_INCOMING_PLACE,
      addResolvedAtIndex,
      navigation,
      day?.activities?.length,
    ])
  );

  /**
   * ✅ EN KRİTİK PARÇA (FIXLİ):
   * Wizard "places" olarak kaydediyor, bazı eski akışlar "selectedPlaces" kullanıyor.
   * Bu yüzden ikisini de destekliyoruz.
   */
  const hydratedSelectedPlacesRef = useRef(false);
  useEffect(() => {
    if (hydratedSelectedPlacesRef.current) return;
    if (!trip || !plan || !Array.isArray(plan?.days) || !plan.days.length) return;

    const rawSelected =
      (Array.isArray(trip?.selectedPlaces) && trip.selectedPlaces) ||
      (Array.isArray(trip?.places) && trip.places) ||
      (Array.isArray(trip?.selected) && trip.selected) ||
      [];

    if (!rawSelected.length) {
      // debug için:
      console.log('[TripPlans] hydrate: no places found on trip', {
        tripId: trip?.id ?? trip?._id,
        hasSelectedPlaces: Array.isArray(trip?.selectedPlaces),
        hasPlaces: Array.isArray(trip?.places),
        selectedPlacesLen: trip?.selectedPlaces?.length,
        placesLen: trip?.places?.length,
      });
      return;
    }

    // Gün zaten doluysa dokunma
    const d0 = plan.days[0];
    if ((d0?.activities || []).length > 0) return;

    // Şehir filtresi (varsa)
    const tripCity =
      trip?.cityName ||
      (Array.isArray(trip?.cities) && trip.cities.length ? trip.cities[0] : '') ||
      '';

    const picked = rawSelected
      .filter(Boolean)
      .filter((sp) => {
        if (!tripCity) return true;
        if (!sp?.city) return true;
        return String(sp.city).toLowerCase() === String(tripCity).toLowerCase();
      })
      .map(selectedPlaceToResolvedLike)
      .filter((r) => !!normalizeResolvedCoords(r));

    if (!picked.length) return;

    console.log('[TripPlans] hydrate places → activities', {
      tripCity,
      rawSelected: rawSelected.length,
      used: picked.length,
      source: Array.isArray(trip?.selectedPlaces) ? 'selectedPlaces' : 'places',
    });

    hydratedSelectedPlacesRef.current = true;

    mutatePlanDays((next) => {
      const d = next.days?.[0];
      if (!d) return;
      if (!Array.isArray(d.activities)) d.activities = [];
      if (d.activities.length > 0) return;

      const acts = picked.map((resolved) => {
        const coords = normalizeResolvedCoords(resolved);
        const id = resolved.key || `tmp:${Date.now()}`;
        const category = resolved?.category || 'sights';
        return {
          id,
          type: 'visit',
          durationMin: 45,
          place: {
            id,
            name: resolved.description || 'Seçilen yer',
            location: { lat: coords.latitude, lon: coords.longitude },
            category,
            address: resolved.address || '',
            photos: Array.isArray(resolved.photoUrls)
              ? resolved.photoUrls.map((u) => ({ url: u }))
              : undefined,
          },
          meta: {
            category,
            googlePlaceId: resolved?.place_id || null,
            place_id: resolved?.place_id || null,
            source: 'selectedPlaces',
          },
        };
      });

      d.activities.push(...acts);
      retimeDay(d);
      rebuildPolyline(d);
    });

    // İstersen otomatik olarak gün 0’a geç:
    // setDayIndex(0);
  }, [trip, plan, mutatePlanDays, retimeDay, rebuildPolyline]);

  /* ------------ Route sheet reset (gün değişince) ------------ */
  useEffect(() => {
    setFocusIdx(0);
    setSelectedActId(null);

    setLegSel(null);
    setLegActs(null);
    setLegWaypoints([]);

    setRouteData(null);
    setRouteLegLabel('');
    setRouteSheetOpen(false);

    const t = setTimeout(() => {
      try {
        fitMapToDayRef.current?.();
      } catch {}
    }, 160);

    return () => clearTimeout(t);
  }, [
    dayIndex,
    setLegSel,
    setLegActs,
    setLegWaypoints,
    setRouteData,
    setRouteLegLabel,
    setRouteSheetOpen,
  ]);

  /* ------------ Harita odak ------------ */

  const focusCorridorAround = useCallback(
    (realIdx) => {
      if (!mapRef.current || !day?.activities?.length) return;
      const arr = day.activities;
      const prev = arr[Math.max(0, realIdx - 1)]?.place?.location || null;
      const next = arr[Math.min(arr.length - 1, realIdx)]?.place?.location || null;

      let target = null;
      if (prev && next)
        target = {
          latitude: (prev.lat + next.lat) / 2,
          longitude: (prev.lon + next.lon) / 2,
        };
      else if (prev) target = { latitude: prev.lat, longitude: prev.lon };
      else if (next) target = { latitude: next.lat, longitude: next.lon };

      if (target) {
        try {
          mapRef.current.animateCamera({ center: target, zoom: 14 }, { duration: 450 });
        } catch {}
      }
    },
    [day?.activities]
  );

  /* ------------ useTripSearch hook (arama + insert/edit) ------------ */

  const {
    searchBarVisible,
    setSearchBarVisible,
    mapSearchQ,
    setMapSearchQ,
    searchMarkers,
    setSearchMarkers,
    searchBusy,

    sheetMarker,
    setSheetMarker,
    sheetVariant,
    setSheetVariant,
    sheetMeta,
    setSheetMeta,

    editIndex,
    setEditIndex,
    insertIndex,
    setInsertIndex,
    insertMode,
    setInsertMode,
    pendingAdd,
    setPendingAdd,

    onSelectSearchResult,
    handleInsertAt,
    handleEditActivityAt,
    onPickInsertIndex,
    onCancelInsertMode,
  } = useTripSearch({
    DIRECTIONS_API_KEY,
    currentMapCenter,
    mapRef,
    uiToReal,
    guardAnchorAction,
    focusCorridorAround,
    addResolvedAtIndex,
    setIsPanelOpen,
  });

  /* ------------ Marker listesi ------------ */

  const mapMarkers = useMemo(() => {
    let visitNo = 0;
    return uiActivities
      .map((a, idx) => {
        const loc = a?.place?.location;
        const lat = loc?.lat;
        const lon = loc?.lon ?? loc?.lng;

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

        const isAnchor = !!a?.meta?.isAnchor;
        const kind = a?.meta?.category;

        let baseColor = COLORS.accent;
        let orderLabel;

        if (isAnchor) {
          if (kind === 'start') {
            baseColor = '#10B981';
            orderLabel = '0';
          } else if (kind === 'end') {
            baseColor = '#EF4444';
            orderLabel = 'B';
          } else {
            baseColor = '#7C3AED';
            orderLabel = 'K';
          }
        } else {
          if (a?.type === 'meal') baseColor = COLORS.success;
          else if (a?.type === 'transfer') baseColor = COLORS.neutral;
          visitNo++;
          orderLabel = String(visitNo);
        }

        return {
          activity: a,
          activityId: a.id,
          key: `${a.id}-${idx}`,
          coordinate: { latitude: lat, longitude: lon },
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

  /* ------------ UI HANDLERS: Timeline & Marker selection ------------ */

  const onTimelineItemPress = useCallback(
    (payload) => {
      if (!payload) return;
      if (typeof payload !== 'object') return;

      const {
        index,
        coord,
        item,
        kind,
        isAnchor,
        photos: payloadPhotos,
        photoUrls: payloadPhotoUrls,
      } = payload;

      const dayData = plan?.days?.[dayIndex];
      const acts = dayData?.activities || [];

      const buildPhotosForPlace = (placeLike) => {
        const rawPhotos = Array.isArray(payloadPhotos)
          ? payloadPhotos
          : Array.isArray(placeLike?.photos)
          ? placeLike.photos
          : [];

        const fromPhotoUrlsBase =
          Array.isArray(payloadPhotoUrls) && payloadPhotoUrls.length
            ? payloadPhotoUrls
            : Array.isArray(placeLike?.photoUrls)
            ? placeLike.photoUrls
            : [];

        const photos = [...rawPhotos, ...fromPhotoUrlsBase.map((u) => ({ url: u }))];
        const photoUrls = photos.map((p) => p.url || p.uri || p.src || p.photoUrl).filter(Boolean);

        return { photos, photoUrls };
      };

      if (isAnchor) {
        let loc = null;
        let label = '';
        let placeLike = item?.place || item;

        if (kind === 'start') {
          loc = anchorInfo.start;
          label = anchorInfo.startLabel || 'Başlangıç';
        } else if (kind === 'end') {
          loc = anchorInfo.end;
          label = anchorInfo.endLabel || 'Bitiş';
        } else if (kind === 'lodging') {
          loc = anchorInfo.lodge;
          label = 'Konaklama';
        }

        if (!loc) return;

        const latitude = loc.lat;
        const longitude = loc.lon ?? loc.lng;

        let { photos, photoUrls } = buildPhotosForPlace(placeLike);

        if ((!photos?.length && !photoUrls?.length) && acts.length) {
          let fallbackAct = null;

          if (kind === 'start') fallbackAct = acts[0];
          else if (kind === 'end') fallbackAct = acts[acts.length - 1];
          else if (kind === 'lodging') {
            fallbackAct =
              acts.find((a) => a.meta?.category === 'lodging') ||
              acts.find((a) => (a.place?.name || '').toLowerCase().includes('otel'));
          }

          if (fallbackAct?.place) {
            const fb = buildPhotosForPlace(fallbackAct.place);
            photos = fb.photos;
            photoUrls = fb.photoUrls;
          }
        }

        setSelectedActId(null);
        setSheetVariant('poi');
        setSheetMeta(label);

        setSheetMarker({
          name: label,
          coords: { latitude, longitude },
          address: placeLike?.address || '',
          photos: photos || [],
          photoUrls: photoUrls || [],
          place_id: placeLike?.id || item?.place_id || null,
        });

        if (mapRef.current && latitude && longitude) {
          try {
            mapRef.current.animateToRegion(
              { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
              350
            );
          } catch {}
        }

        return;
      }

      const realIndex = uiToReal(index);
      const d = plan?.days?.[dayIndex];
      const acts2 = d?.activities || [];
      const act = realIndex != null ? acts2[realIndex] : item || null;
      if (!act) return;

      const place = act.place || item?.place;
      const baseName = place?.name || getActName(act, realIndex) || 'Seçilen durak';

      const loc = place?.location;
      const latitude = loc?.lat ?? coord?.latitude;
      const longitude = loc?.lon ?? loc?.lng ?? coord?.longitude;

      const { photos, photoUrls } = buildPhotosForPlace(place || item);

      setSelectedActId(act.id);
      setSheetVariant('poi');
      setSheetMeta('timeline');

      setSheetMarker({
        name: baseName,
        coords: latitude && longitude ? { latitude, longitude } : coord,
        address: place?.address || '',
        photos: photos || [],
        photoUrls: photoUrls || [],
        place_id: place?.id || act.meta?.googlePlaceId || act.meta?.place_id || null,
      });

      if (mapRef.current && latitude && longitude) {
        try {
          mapRef.current.animateToRegion(
            { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
            350
          );
        } catch {}
      }
    },
    [
      anchorInfo,
      uiToReal,
      plan,
      dayIndex,
      setSelectedActId,
      setSheetMarker,
      setSheetVariant,
      setSheetMeta,
      mapRef,
    ]
  );

  const onMapMarkerPress = useCallback(
    (actId) => {
      if (!actId) return;

      const now = Date.now();
      if (now - lastMarkerPressRef.current < 300) return;
      lastMarkerPressRef.current = now;

      const m = mapMarkers.find((x) => x.activityId === actId);
      if (!m) return;

      onTimelineItemPress({
        index: m.uiIndex,
        coord: m.coordinate,
        item: m.activity,
        kind: m.kind,
        isAnchor: m.isAnchor,
        photos: m.activity?.place?.photos,
        photoUrls: m.activity?.place?.photoUrls,
      });
    },
    [mapMarkers, onTimelineItemPress]
  );

  const handleDeleteActivityAt = useCallback(
    (uiIdx) => {
      if (guardAnchorAction(uiIdx)) return;
      const realIdx = uiToReal(uiIdx);
      if (realIdx == null) return;

      mutatePlanDays((next) => {
        const d = next.days?.[dayIndex];
        if (!d) return;
        const arr = d.activities || [];
        if (realIdx < 0 || realIdx >= arr.length) return;
        arr.splice(realIdx, 1);
        retimeDay(d);
        rebuildPolyline(d);
      });
    },
    [guardAnchorAction, uiToReal, mutatePlanDays, dayIndex, retimeDay, rebuildPolyline]
  );

  const handleReorder = useCallback(
    (fromUi, toUi) => {
      if (guardAnchorAction(fromUi) || guardAnchorAction(toUi)) return;
      const from = uiToReal(fromUi);
      const to = uiToReal(toUi);

      mutatePlanDays((n) => {
        const acts = n.days[dayIndex].activities;
        if (from < 0 || to < 0 || from >= acts.length || to >= acts.length) return;
        const [removed] = acts.splice(from, 1);
        acts.splice(to, 0, removed);
        retimeDay(n.days[dayIndex]);
        rebuildPolyline(n.days[dayIndex]);
      });
    },
    [guardAnchorAction, uiToReal, mutatePlanDays, dayIndex, retimeDay, rebuildPolyline]
  );

  /* ------------ RETURN ------------ */

  return {
    loading,
    trip,
    setTrip,
    plan,
    setPlan,
    dayIndex,
    setDayIndex,
    day,

    isPanelOpen,
    setIsPanelOpen,
    onTogglePanel: () => setIsPanelOpen((s) => !s),

    searchBarVisible,
    setSearchBarVisible,
    mapSearchQ,
    setMapSearchQ,
    searchMarkers,
    setSearchMarkers,
    searchBusy,

    mapRef,
    currentMapCenter,
    selectedActId,
    setSelectedActId,
    markerRefs,
    focusIdx,
    setFocusIdx,

    sheetMarker,
    setSheetMarker,
    sheetVariant,
    setSheetVariant,
    sheetMeta,
    setSheetMeta,

    routeData,
    setRouteData,
    routeSheetOpen,
    setRouteSheetOpen,
    legSel,
    setLegSel,
    legActs,
    setLegActs,
    legWaypoints,
    setLegWaypoints,
    routeLegLabel,
    setRouteLegLabel,

    permissionPrompt,
    setPermissionPrompt,

    datePickOpen,
    setDatePickOpen,
    datePickIndex,
    setDatePickIndex,
    datePickValue,
    setDatePickValue,

    segments,
    mapMarkers,
    uiActivities,
    anchorInfo,

    editIndex,
    setEditIndex,
    insertIndex,
    setInsertIndex,
    insertMode,
    setInsertMode,
    pendingAdd,
    setPendingAdd,

    addResolvedAtIndex,
    mutatePlanDays,
    retimeDay,
    rebuildPolyline,
    optimizeCurrentDay,
    reoptimizeCurrentDay,
    pickLeg,
    deleteDayAt,
    addEmptyDay,
    ensureLocationBeforeStart,
    setDayDateAt,

    onTimelineItemPress,
    onMapMarkerPress,
    onSelectSearchResult,
    onCancelInsertMode,
    onMapRegionChanged: (region) => {
      if (region)
        currentMapCenter.current = { lat: region.latitude, lng: region.longitude };
    },

    handleInsertAt,
    handleEditActivityAt,
    handleDeleteActivityAt,
    handleReorder,
    onPickInsertIndex,

    uiToReal,
    guardAnchorAction,
    focusCorridorAround,

    goPrevDay: () => setDayIndex((i) => Math.max(0, i - 1)),
    goNextDay: () =>
      setDayIndex((i) => Math.min((plan?.days?.length || 1) - 1, i + 1)),

    DIRECTIONS_API_KEY,

    onPickLegPair,
  };
}
