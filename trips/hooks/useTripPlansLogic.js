// trips/hooks/useTripPlansLogic.js
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Alert,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
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
  extractPhotoUrlsFromActivity,
  coercePhotoInputsToUrls,
  extractPossiblePlaceIdFromActivity,
  isStrictPlaceId,
  round5k,
  boundsToRegion,
  getDetailsWithCache,
  ensureResolvedForPlan,
  limitPhotos,
} from '../components/TripPlanHelpers';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
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

  const {
    loading,
    trip,
    setTrip,
    plan,
    setPlan,
    dayIndex,
    setDayIndex,
    day,
  } = useTripAndPlan({ tripId, navigation, route, prefs });

  /* ------------ Anchors + UI Activities (Hook) ------------ */

  const { anchorInfo, uiActivities, uiToReal, guardAnchorAction } =
    useTripAnchors({ trip, day, plan, dayIndex });

  /* ------------ Segment & fit hook ------------ */

  const { segments, fitMapToDay } = useTripSegments({
    day,
    uiActivities,
    mapRef,
  });

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

  const {
    permissionPrompt,
    setPermissionPrompt,
    ensureLocationBeforeStart,
  } = useTripLocationGuard();

  /* ------------ Plan / gün mutate helperları ------------ */

  const resequenceAllDays = useCallback(
    (baseIndex) => {
      setPlan((prev) => {
        if (!prev?.days?.length) return prev;
        const next = {
          ...prev,
          days: prev.days.map((d) => ({ ...d })),
        };

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
        for (let i = anchor - 1; i >= 0; i--) {
          next.days[i].date = addDaysISO(anchorISO, i - anchor);
        }
        for (let i = anchor + 1; i < next.days.length; i++) {
          next.days[i].date = addDaysISO(anchorISO, i - anchor);
        }

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
            .map((d) => ({
              ...d,
              activities: [...(d.activities || [])],
            })),
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

  const reoptimizeCurrentDay = useCallback(() => {
  mutatePlanDays((next) => {
    const d = next.days?.[dayIndex];
    if (!d) return;

    // Sadece o günün aktivitelerini şu anki sıraya göre yeniden zamanla
    retimeDay(d);
    rebuildPolyline(d);
  });
}, [mutatePlanDays, dayIndex, retimeDay, rebuildPolyline]);

  const rebuildPolyline = useCallback((d) => {
    const pts = [];
    d.activities.forEach((a) => {
      const loc = a?.place?.location;
      if (loc) pts.push({ lat: loc.lat, lon: loc.lon });
    });
    d.route = {
      ...(d.route || {}),
      polyline: pts,
      optimizerUsed: false,
    };
  }, []);

  const addResolvedAtIndex = useCallback(
    (idx, resolved) => {
      if (!resolved) return;
      const id = resolved.key || `tmp:${Date.now()}`;
      const act = {
        id,
        type: 'visit',
        durationMin: 45,
        place: {
          id,
          name: resolved.description || 'Seçilen yer',
          location: resolved.coords
            ? {
                lat: resolved.coords.latitude,
                lon: resolved.coords.longitude,
              }
            : null,
          category: 'sights',
          address: resolved.address || '',
          photos: Array.isArray(resolved.photoUrls)
            ? resolved.photoUrls.map((u) => ({ url: u }))
            : undefined,
        },
        meta: { category: 'sights' },
      };

      mutatePlanDays((next) => {
        const d = next.days?.[dayIndex];
        if (!d) return;
        const pos = Math.min(
          Math.max(idx ?? 0, 0),
          d.activities.length
        );
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
      const ordered = optimizeDayWithAnchors(
        d,
        trip,
        getAnchorsForDayDetailed
      );
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
      requestAnimationFrame(() =>
        resequenceAllDays(Math.max(0, idx - 1))
      );
    },
    [mutatePlanDays, resequenceAllDays, setDayIndex]
  );

  const addEmptyDay = useCallback(() => {
    mutatePlanDays((next) => {
      const lastISO = next.days.length
        ? toISODateSafe(next.days[next.days.length - 1].date)
        : toISODateSafe(new Date());
      const newISO = addDaysISO(lastISO, 1);
      next.days.push({
        id: uid(),
        date: newISO,
        activities: [],
      });
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
        return {
          ...prev,
          days: arr,
          updatedAt: new Date().toISOString(),
        };
      });
      requestAnimationFrame(() => resequenceAllDays(idx));
    },
    [setPlan, resequenceAllDays]
  );

  /* ------------ Route sheet reset (gün değişince) ------------ */

  useEffect(() => {
    setFocusIdx(0);
    setSelectedActId(null);
    setLegSel(null);
    setRouteData(null);
    setLegWaypoints(null);
    setLegActs(null);
    const t = setTimeout(fitMapToDay, 160);
    return () => clearTimeout(t);
  }, [
    dayIndex,
    fitMapToDay,
    setLegSel,
    setRouteData,
    setLegActs,
    setLegWaypoints,
  ]);

  /* ------------ Harita odak ------------ */

  const focusCorridorAround = useCallback(
    (realIdx) => {
      if (!mapRef.current || !day?.activities?.length) return;
      const arr = day.activities;
      const prev = arr[Math.max(0, realIdx - 1)]?.place?.location || null;
      const next =
        arr[Math.min(arr.length - 1, realIdx)]?.place?.location || null;
      let target = null;
      if (prev && next)
        target = {
          latitude: (prev.lat + next.lat) / 2,
          longitude: (prev.lon + next.lon) / 2,
        };
      else if (prev) target = { latitude: prev.lat, longitude: prev.lon };
      else if (next) target = { latitude: next.lat, longitude: next.lon };
      if (target)
        try {
          mapRef.current.animateCamera(
            { center: target, zoom: 14 },
            { duration: 450 }
          );
        } catch {}
    },
    [day?.activities]
  );

  const focusActivity = useCallback(
    (realIndexOrId) => {
      if (!day?.activities?.length || !mapRef.current) return;
      let index = -1;
      if (typeof realIndexOrId === 'number') index = realIndexOrId;
      else
        index = day.activities.findIndex(
          (a) => (a.id || a._id) === realIndexOrId
        );
      if (index < 0) return;
      const activity = day.activities[index];
      const loc = activity?.place?.location;
      if (!loc) return;
      const coordinate = {
        latitude: loc.lat,
        longitude: loc.lon ?? loc.lng,
      };
      try {
        mapRef.current.animateCamera(
          { center: coordinate, zoom: 16 },
          { duration: 350 }
        );
      } catch {}
      setTimeout(() => {
        try {
          mapRef.current.animateCamera(
            { center: coordinate, zoom: 16 },
            { duration: 350 }
          );
        } catch {}
        setTimeout(() => {
          try {
            mapRef.current.animateToRegion(
              {
                ...coordinate,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              },
              350
            );
          } catch {}
        }, 150);
      }, 280);
    },
    [day]
  );

  /* ------------ useTripSearch hook (arama + insert/edit) ------------ */

  const {
    searchBarVisible,
    setSearchBarVisible,
    mapSearchQ,
    setMapSearchQ,
    searchMarkers,
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
        if (!loc) return null;
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

  /* ------------ UI HANDLERS: Timeline & Marker selection ------------ */

  const onTimelineItemPress = useCallback(
    async (payload) => {
      if (!day || !Array.isArray(day.activities)) return;

      let act = null;
      let realIdx = -1;

      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const item = payload.item;
        const idxFromPayload =
          typeof payload.index === 'number' ? payload.index : -1;

        if (item?.meta?.isAnchor) {
          return;
        }

        if (
          idxFromPayload >= 0 &&
          idxFromPayload < day.activities.length
        ) {
          realIdx = idxFromPayload;
          act = day.activities[realIdx];
        } else if (item?.id || item?._id) {
          const candidateId = item.id || item._id;
          realIdx = day.activities.findIndex(
            (a) => (a.id || a._id) === candidateId
          );
          if (realIdx >= 0) act = day.activities[realIdx];
        }
      } else if (typeof payload === 'string') {
        const idStr = payload;
        realIdx = day.activities.findIndex(
          (a) => (a.id || a._id) === idStr
        );
        if (realIdx >= 0) act = day.activities[realIdx];
      }

      if (!act || realIdx < 0) return;

      // Haritayı focusla
      focusActivity(realIdx);

      const actId = act.id || act._id || null;
      if (actId) setSelectedActId(actId);
      setFocusIdx(realIdx);

      const loc = act.place?.location;
      const coords = loc
        ? {
            latitude: loc.lat,
            longitude: loc.lon ?? loc.lng,
          }
        : null;

      let rawPhotos = extractPhotoUrlsFromActivity(act) || [];
      let photoUrls = limitPhotos(
        coercePhotoInputsToUrls(rawPhotos, DIRECTIONS_API_KEY, {
          maxwidth: 640,
        }),
        2
      );

      const placeId = extractPossiblePlaceIdFromActivity(act);
      if ((!photoUrls || !photoUrls.length) && isStrictPlaceId(placeId)) {
        try {
          const det = await getDetailsWithCache(placeId);
          if (det?.photos?.length) {
            const detUrls = limitPhotos(
              coercePhotoInputsToUrls(
                det.photos,
                DIRECTIONS_API_KEY,
                { maxwidth: 640 }
              ),
              2
            );
            if (detUrls?.length) {
              photoUrls = detUrls;
            }
          }
        } catch (e) {
          console.warn(
            '[Timeline] place details foto hatası:',
            e?.message
          );
        }
      }

      setSheetMarker({
        name: getActName(act, realIdx),
        address:
          act.place?.address || act.place?.formatted_address || '',
        coords,
        photoUrls: photoUrls || [],
        place_id: placeId || null,
        act,
      });

      setSheetVariant('existing');
      setSheetMeta('timeline');
    },
    [day, focusActivity]
  );

  const onMapMarkerPress = useCallback(
    (actId) => {
      if (!actId) return;
      const now = Date.now();
      if (now - lastMarkerPressRef.current < 300) {
        return;
      }
      lastMarkerPressRef.current = now;
      onTimelineItemPress(
        typeof actId === 'string' ? actId : String(actId)
      );
    },
    [onTimelineItemPress]
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
    [
      guardAnchorAction,
      uiToReal,
      mutatePlanDays,
      dayIndex,
      retimeDay,
      rebuildPolyline,
    ]
  );

  const handleReorder = useCallback(
    (fromUi, toUi) => {
      if (guardAnchorAction(fromUi) || guardAnchorAction(toUi)) return;
      const from = uiToReal(fromUi);
      const to = uiToReal(toUi);
      mutatePlanDays((n) => {
        const acts = n.days[dayIndex].activities;
        if (
          from < 0 ||
          to < 0 ||
          from >= acts.length ||
          to >= acts.length
        )
          return;
        const [removed] = acts.splice(from, 1);
        acts.splice(to, 0, removed);
        retimeDay(n.days[dayIndex]);
        rebuildPolyline(n.days[dayIndex]);
      });
    },
    [
      guardAnchorAction,
      uiToReal,
      mutatePlanDays,
      dayIndex,
      retimeDay,
      rebuildPolyline,
    ]
  );

  /* ------------ RETURN ------------ */

  return {
    // durum
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

    // core
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

    // UI handlers
    onTimelineItemPress,
    onMapMarkerPress,
    onSelectSearchResult,
    onCancelInsertMode,
    onMapRegionChanged: (region) => {
      if (region)
        currentMapCenter.current = {
          lat: region.latitude,
          lng: region.longitude,
        };
    },

    handleInsertAt,
    handleEditActivityAt,
    handleDeleteActivityAt,
    handleReorder,
    onPickInsertIndex,

    // helperlar
    uiToReal,
    guardAnchorAction,
    focusCorridorAround,

    goPrevDay: () => setDayIndex((i) => Math.max(0, i - 1)),
    goNextDay: () =>
      setDayIndex((i) =>
        Math.min((plan?.days?.length || 1) - 1, i + 1)
      ),

    DIRECTIONS_API_KEY,

    // Eski davranışın hook versiyonu
    onPickLegPair,
  };
}
