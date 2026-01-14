// /trips/screens/TripPlansScreen.js
import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Dimensions,
  ActivityIndicator,
  Alert,
  ScrollView,
  TouchableOpacity,
  Modal,
  InteractionManager,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import * as Location from 'expo-location';

// --- Custom Hook (Mantık Katmanı) ---
import { useTripPlansLogic } from '../hooks/useTripPlansLogic';

// --- Bileşenler ---
import SideTimeline from '../components/timeline/sidetimeline/SideTimeline';
import PlaceQuickCard from '../../map/components/PlaceQuickCard';
import TripRouteSheet from '../components/TripRouteSheet';
import PermissionPromptModal from '../../map/components/PermissionPromptModal';

// --- Stiller ve Helperlar ---
import {
  styles,
  COLORS,
  LEFT_OPEN_W,
  LEFT_CLOSED_W,
  TOGGLE_PEEK,
  TOGGLE_SIZE,
} from '../components/TripPlanStyles';

import {
  toISODateSafe,
  formatDate,
  getActName,
  extractPossiblePlaceIdFromActivity,
  navigateToTurnByTurn,
} from '../components/TripPlanHelpers';

/* =========================================================
   🔥 DEBUG / CRASH-TRACE FLAGS (sadece tespit için)
   Test ederken true/false değiştir.
   ========================================================= */
const DEBUG_CRASH_MARKS = true;

// 1) Gün değişiminde overlay kapatma + reset işlemlerini devre dışı bırakır
// (Sadece setDayIndex çalışsın istiyorsan true yap.)
const DEBUG_DISABLE_DAY_SWITCH_EFFECTS = false;

// 2) Map tamamen render edilmesin (Polyline/Marker dahil) → Map kaynaklı crash mi anlarız
const DEBUG_DISABLE_MAP_RENDER = false;

// 3) Segment polyline’larını render etme (çok önemli izolasyon)
const DEBUG_DISABLE_SEGMENT_POLYLINES = false;

// 4) Route sheet render etme (TripRouteSheet)
const DEBUG_DISABLE_ROUTE_SHEET = false;

// 5) QuickCard render etme
const DEBUG_DISABLE_QUICKCARD = false;

/* ---- Crash marker helper ---- */
const mark = (label, extra) => {
  if (!DEBUG_CRASH_MARKS) return;
  const t = Date.now();
  console.log(`[CRASH-MARK] ${t} ${label}`, extra ?? '');
  global.__LAST_CRASH_MARK__ = { t, label, extra };
};

/* ---- Marker Child Component (Memoized) ---- */
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

/**
 * ✅ MEM LOGGER (CUSTOM HOOK)
 * Interval sadece 1 kere kurulmalı.
 * Değişen değerler ref ile okunmalı.
 */
function useMemLogger({
  enabled,
  dayIndex,
  markersLen,
  segmentsLen,
  searchMarkersLen,
  uiActsLen,
  polylineLen,
}) {
  const tickRef = useRef(0);
  const intervalRef = useRef(null);

  // ✅ Sürekli değişen değerleri burada ref’e yaz
  const liveRef = useRef({
    dayIndex: 0,
    markersLen: 0,
    segmentsLen: 0,
    searchMarkersLen: 0,
    uiActsLen: 0,
    polylineLen: 0,
  });

  useEffect(() => {
    liveRef.current = {
      dayIndex,
      markersLen,
      segmentsLen,
      searchMarkersLen,
      uiActsLen,
      polylineLen,
    };
  }, [dayIndex, markersLen, segmentsLen, searchMarkersLen, uiActsLen, polylineLen]);

  // ✅ Interval sadece enabled değişince kurulsun/kalksın
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // enabled true olduğunda sıfırdan başlatmak istersen:
    tickRef.current = 0;

    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      tickRef.current += 1;
      try {
        const mem = global?.performance?.memory; // Hermes’te çoğu zaman undefined
        const s = liveRef.current;

        console.log('[MEM]', tickRef.current, {
          dayIndex: s.dayIndex,
          jsHeapSizeLimit: mem?.jsHeapSizeLimit,
          usedJSHeapSize: mem?.usedJSHeapSize,
          totalJSHeapSize: mem?.totalJSHeapSize,
          markers: s.markersLen,
          segments: s.segmentsLen,
          searchMarkers: s.searchMarkersLen,
          uiActs: s.uiActsLen,
          polyline: s.polylineLen,
        });
      } catch (e) {
        const s = liveRef.current;
        console.log('[MEM]', tickRef.current, { dayIndex: s.dayIndex });
      }
    }, 1500);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled]);
}

/**
 * Tek yerde tüm koordinatları normalize eden yardımcı fonksiyon.
 * Ne gelirse gelsin (coords, location, geometry, lat/lng, latitude/longitude)
 * buradan { latitude, longitude } çıkarıyoruz.
 */
function resolveCoords(markerLike) {
  if (!markerLike) return null;

  // 1) markerLike.coords
  let c = markerLike.coords;
  if (c) {
    const lat = c.latitude ?? c.lat;
    const lon = c.longitude ?? c.lon ?? c.lng;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { latitude: lat, longitude: lon };
    }
  }

  // 2) markerLike.location
  if (markerLike.location) {
    const lat = markerLike.location.latitude ?? markerLike.location.lat;
    const lon =
      markerLike.location.longitude ??
      markerLike.location.lon ??
      markerLike.location.lng;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { latitude: lat, longitude: lon };
    }
  }

  // 3) markerLike.place?.location
  if (markerLike.place && markerLike.place.location) {
    const lat =
      markerLike.place.location.latitude ?? markerLike.place.location.lat;
    const lon =
      markerLike.place.location.longitude ??
      markerLike.place.location.lon ??
      markerLike.place.location.lng;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { latitude: lat, longitude: lon };
    }
  }

  // 4) Google Places tipik geometry.location
  if (markerLike.geometry && markerLike.geometry.location) {
    const lat =
      markerLike.geometry.location.latitude ??
      markerLike.geometry.location.lat;
    const lon =
      markerLike.geometry.location.longitude ??
      markerLike.geometry.location.lng ??
      markerLike.geometry.location.lon;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { latitude: lat, longitude: lon };
    }
  }

  // 5) Düz lat / lng alanları
  if (
    markerLike.lat != null &&
    (markerLike.lng != null || markerLike.lon != null)
  ) {
    const lat = markerLike.lat;
    const lon = markerLike.lng ?? markerLike.lon;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { latitude: lat, longitude: lon };
    }
  }

  // 6) latitude / longitude
  if (
    markerLike.latitude != null &&
    (markerLike.longitude != null || markerLike.lon != null)
  ) {
    const lat = markerLike.latitude;
    const lon = markerLike.longitude ?? markerLike.lon;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { latitude: lat, longitude: lon };
    }
  }

  return null;
}

export default function TripPlansScreen({ route, navigation }) {
  const { tripId } = route.params || {};
  const insets = useSafeAreaInsets();

  // 1️⃣ TÜM MANTIK HOOK İÇİNDEN ÇAĞRILIYOR
  const logic = useTripPlansLogic({ tripId, navigation, route });

  const {
    loading,
    trip,
    plan,
    day,
    dayIndex,
    setDayIndex,
    isPanelOpen,
    onTogglePanel,
    setIsPanelOpen,

    // Search & Map
    searchBarVisible,
    setSearchBarVisible,
    mapSearchQ,
    setMapSearchQ,
    searchMarkers,
    setSearchMarkers,
    searchBusy,
    mapRef,
    selectedActId,
    setSelectedActId,
    sheetMarker,
    setSheetMarker,
    sheetVariant,
    setSheetVariant,
    sheetMeta,
    setSheetMeta,

    // Route
    routeData,
    setRouteData,
    routeSheetOpen,
    setRouteSheetOpen,
    legWaypoints,
    setLegWaypoints,
    routeLegLabel,
    setRouteLegLabel,
    legActs,
    legSel,

    // Modal
    permissionPrompt,
    setPermissionPrompt,
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
    datePickOpen,
    setDatePickOpen,
    datePickIndex,
    setDatePickIndex,
    datePickValue,
    setDatePickValue,

    // Fonksiyonlar
    addResolvedAtIndex,
    mutatePlanDays,
    retimeDay,
    rebuildPolyline,
    pickLeg,
    ensureLocationBeforeStart,
    goPrevDay,
    goNextDay,
    addEmptyDay,
    deleteDayAt,
    setDayDateAt,

    // UI Handlers
    onTimelineItemPress,
    onMapMarkerPress,
    onSelectSearchResult,
    onCancelInsertMode,
    onPickInsertIndex,
    onMapRegionChanged,

    // Hook'tan gelenler
    uiToReal,
    guardAnchorAction,
    focusCorridorAround,

    // API Key
    DIRECTIONS_API_KEY,
  } = logic;

  // ✅ MEM LOGGER — artık interval spam yapmaz
  useMemLogger({
    enabled: true,
    dayIndex,
    markersLen: mapMarkers?.length ?? 0,
    segmentsLen: segments?.length ?? 0,
    searchMarkersLen: searchMarkers?.length ?? 0,
    uiActsLen: uiActivities?.length ?? 0,
    polylineLen: routeData?.polylineCoords?.length ?? 0,
  });

  // ✅ QuickCard açıksa sol paneli tamamen gizleyelim
  const panelVisible = isPanelOpen && !sheetMarker;
  const toggleLeft = panelVisible
    ? LEFT_OPEN_W - TOGGLE_SIZE / 2 + 8
    : -TOGGLE_SIZE / 2 + TOGGLE_PEEK;

  /**
   * ✅ DONMA ÖNLEME 1:
   * Gün değiştirirken aynı anda çok fazla state tetiklenmesin diye küçük throttle.
   */
  const daySwitchGuardRef = useRef(0);
  const changeDayTo = useCallback(
    (i) => {
      mark('DAY_CLICK_START', { targetDayIndex: i, current: dayIndex });

      const now = Date.now();
      if (now - daySwitchGuardRef.current < 350) {
        mark('DAY_CLICK_THROTTLED');
        return;
      }
      daySwitchGuardRef.current = now;

      if (!plan?.days?.length) return;
      if (i < 0 || i >= plan.days.length) return;
      if (i === dayIndex) return;

      // ✅ İzolasyon: Sadece setDayIndex çalışsın istiyorsan
      if (!DEBUG_DISABLE_DAY_SWITCH_EFFECTS) {
        mark('DAY_CLICK_BEFORE_RESET_OVERLAYS');

        // Gün değiştirirken overlay’leri kapat
        setSheetMarker(null);
        setRouteSheetOpen(false);
        setRouteData(null);
        setRouteLegLabel('');
        setLegWaypoints([]);
        setSearchBarVisible(false);

        mark('DAY_CLICK_AFTER_RESET_OVERLAYS');
      } else {
        mark('DAY_CLICK_RESET_SKIPPED');
      }

      // UI etkileşimi bitince setDayIndex
      InteractionManager.runAfterInteractions(() => {
        mark('DAY_CLICK_BEFORE_SET_DAYINDEX', { i });
        setDayIndex(i);
        mark('DAY_CLICK_AFTER_SET_DAYINDEX', { i });
      });
    },
    [
      plan?.days?.length,
      dayIndex,
      setDayIndex,
      setSheetMarker,
      setRouteSheetOpen,
      setRouteData,
      setRouteLegLabel,
      setLegWaypoints,
      setSearchBarVisible,
    ]
  );

  /**
   * ✅ DONMA ÖNLEME 2:
   * SideTimeline’a verilen plan objesi memoized.
   */
  const timelinePlan = useMemo(() => {
    if (!plan?.days?.length) return plan;

    const days = plan.days.map((d, i) =>
      i === dayIndex ? { ...d, activities: uiActivities } : d
    );

    return { ...plan, days };
  }, [plan, dayIndex, uiActivities]);

  // Harita Uzun Basma → yeni durak eklemek için
  const handleMapLongPress = useCallback(
    (e) => {
      const c = e?.nativeEvent?.coordinate;
      if (!c) return;

      const lat = c.latitude;
      const lng = c.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      setIsPanelOpen(false);
      setSheetVariant('add');
      setSheetMeta('map-long-press');

      const coords = { latitude: lat, longitude: lng };

      setSheetMarker({
        name: 'Seçilen konum',
        coords,
        address: '',
        photoUrls: [],
        photos: [],
        place_id: null,
      });
    },
    [setIsPanelOpen, setSheetMarker, setSheetVariant, setSheetMeta]
  );

  // Quick Card Butonu (Ekleme/Düzenleme)
  const handleQuickCardCta = useCallback(
    (markerLike) => {
      if (!markerLike) return;

      const coords = resolveCoords(markerLike);
      if (!coords) {
        Alert.alert(
          'Hata',
          'Bu yerin konumu alınamadı. Lütfen haritadan tekrar seçmeyi dene.'
        );
        return;
      }

      const fromPhotoUrls =
        markerLike?.photoUrls && Array.isArray(markerLike.photoUrls)
          ? markerLike.photoUrls
          : [];
      const fromPhotos =
        markerLike?.photos && Array.isArray(markerLike.photos)
          ? markerLike.photos
          : [];

      const mergedPhotoUrls = [
        ...fromPhotoUrls,
        ...fromPhotos
          .map((p) => p.url || p.uri || p.src || p.photoUrl)
          .filter(Boolean),
      ];

      const mainName =
        markerLike?.name ||
        markerLike?.title ||
        markerLike?.primaryText ||
        markerLike?.address ||
        'Seçilen konum';

      const sel = {
        key:
          markerLike?.place_id ||
          `map:${Math.round((coords.latitude ?? 0) * 1e6)}_${Math.round(
            (coords.longitude ?? 0) * 1e6
          )}`,
        description: mainName,
        coords,
        address: markerLike?.address || '',
        photoUrls: mergedPhotoUrls,
      };

      setSheetMarker(null);

      setRouteData(null);
      setRouteSheetOpen(false);

      if (editIndex != null) {
        mutatePlanDays((next) => {
          const d = next.days?.[dayIndex];
          if (!d) return;
          const arr = d.activities || [];
          if (editIndex < 0 || editIndex >= arr.length) return;

          const existingId = arr[editIndex]?.id;
          const id = existingId || sel.key || `tmp:${Date.now()}`;

          const act = {
            id,
            type: 'visit',
            durationMin: 45,
            place: {
              id,
              name: sel.description || 'Seçilen yer',
              location: {
                lat: sel.coords.latitude,
                lon: sel.coords.longitude,
              },
              category: 'sights',
              address: sel.address || '',
              photos: Array.isArray(sel.photoUrls)
                ? sel.photoUrls.map((u) => ({ url: u }))
                : undefined,
            },
            meta: { category: 'sights' },
          };

          arr.splice(editIndex, 1, act);
          retimeDay(d);
          rebuildPolyline(d);
          setSelectedActId(act.id);
        });

        setEditIndex(null);
        setPendingAdd(null);
        setInsertMode(false);
        setSearchBarVisible(false);
        setInsertIndex(null);
        setMapSearchQ('');
        setSearchMarkers([]);
        setIsPanelOpen(true);

        if (mapRef.current) {
          try {
            mapRef.current.animateToRegion(
              {
                latitude: coords.latitude,
                longitude: coords.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              },
              300
            );
          } catch {}
        }

        return;
      }

      if (typeof insertIndex === 'number') {
        addResolvedAtIndex(insertIndex, sel);
        setPendingAdd(null);
        setInsertMode(false);
        setIsPanelOpen(true);
        setSearchBarVisible(false);
        setMapSearchQ('');
        setSearchMarkers([]);
        setInsertIndex(null);

        if (mapRef.current) {
          try {
            mapRef.current.animateToRegion(
              {
                latitude: coords.latitude,
                longitude: coords.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              },
              300
            );
          } catch {}
        }

        return;
      }

      setPendingAdd(sel);
      setInsertMode(true);
      setIsPanelOpen(true);
      setSearchBarVisible(false);
    },
    [
      editIndex,
      dayIndex,
      mutatePlanDays,
      retimeDay,
      rebuildPolyline,
      setSelectedActId,
      addResolvedAtIndex,
      insertIndex,
      setSheetMarker,
      setEditIndex,
      setPendingAdd,
      setInsertMode,
      setIsPanelOpen,
      setSearchBarVisible,
      setInsertIndex,
      setMapSearchQ,
      setSearchMarkers,
      setRouteData,
      setRouteSheetOpen,
      mapRef,
    ]
  );

  const fitToSearchResults = useCallback(() => {
    if (!mapRef.current || !searchMarkers.length) return;
    const coords = searchMarkers.map((s) => s.coord);
    try {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 80, bottom: 200, left: 80 },
        animated: true,
      });
    } catch {}
  }, [searchMarkers, mapRef]);

  const handleDeleteActivityAt = useCallback(
    (uiIdx) => {
      const uiIndex =
        typeof uiIdx === 'object' && uiIdx !== null ? uiIdx.index : uiIdx;
      if (guardAnchorAction(uiIndex)) return;
      const realIdx = uiToReal(uiIndex);
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

      setRouteData(null);
      setRouteSheetOpen(false);
    },
    [
      guardAnchorAction,
      uiToReal,
      mutatePlanDays,
      dayIndex,
      retimeDay,
      rebuildPolyline,
      setRouteData,
      setRouteSheetOpen,
    ]
  );

  const handleStartEditAt = useCallback(
    (uiIdx) => {
      const uiIndex =
        typeof uiIdx === 'object' && uiIdx !== null ? uiIdx.index : uiIdx;
      if (guardAnchorAction(uiIndex)) return;
      const realIdx = uiToReal(uiIndex);
      setEditIndex(realIdx);
      setInsertIndex(realIdx);
      if (isPanelOpen) setIsPanelOpen(false);
      setSearchBarVisible(true);
    },
    [
      guardAnchorAction,
      uiToReal,
      setEditIndex,
      setInsertIndex,
      isPanelOpen,
      setIsPanelOpen,
      setSearchBarVisible,
    ]
  );

  const normalizedSheetMarker =
    sheetMarker && typeof sheetMarker === 'object'
      ? (() => {
          const sm = sheetMarker;
          const fromPhotoUrls =
            sm.photoUrls && Array.isArray(sm.photoUrls) ? sm.photoUrls : [];
          const fromPhotos =
            sm.photos && Array.isArray(sm.photos) ? sm.photos : [];

          const mergedPhotoUrls = [
            ...fromPhotoUrls,
            ...fromPhotos
              .map((p) => p.url || p.uri || p.src || p.photoUrl)
              .filter(Boolean),
          ];

          const mergedPhotos = [
            ...fromPhotos,
            ...fromPhotoUrls.map((u) => ({ url: u })),
          ];

          return {
            ...sm,
            photoUrls: mergedPhotoUrls,
            photos: mergedPhotos,
          };
        })()
      : sheetMarker;

  const cityLabel =
    Array.isArray(trip?.cities) && trip.cities.length
      ? trip.cities.join(' • ')
      : trip?.title || 'Gezi Planı';
  const dateLabel =
    trip?.dateRange?.start && trip?.dateRange?.end
      ? `${formatDate(trip.dateRange.start)} – ${formatDate(
          trip.dateRange.end
        )}`
      : '';

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
      <View
        style={[
          styles.header,
          { paddingTop: insets.top, minHeight: 56 + insets.top },
        ]}
      >
        <TouchableOpacity
          onPress={() => navigation.navigate('TripsHome')}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color={COLORS.fg} />
        </TouchableOpacity>

        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={styles.headerCity} numberOfLines={1}>
            {cityLabel}
          </Text>
          {!!dateLabel && (
            <Text style={styles.headerDates} numberOfLines={1}>
              {dateLabel}
            </Text>
          )}
        </View>

        <TouchableOpacity
          onPress={() => navigation.navigate('TripReview', { tripId })}
          style={styles.replanBtnHeader}
        >
          <Ionicons
            name="chevron-forward"
            size={16}
            color={COLORS.fg}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.replanText}>Yeniden Planla</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setSearchBarVisible(true)}
          style={styles.iconOnlyBtn}
        >
          <Ionicons name="search" size={18} color={COLORS.fg} />
        </TouchableOpacity>
      </View>

      {/* Gün şeridi */}
      <View style={styles.daysBar} pointerEvents="auto">
        <View style={styles.dayArrows}>
          <Pressable
            onPress={() => {
              mark('PREV_DAY_PRESS');
              goPrevDay();
            }}
            style={styles.dayArrowBtn}
          >
            <Ionicons name="caret-back" size={18} color={COLORS.fg} />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 10, alignItems: 'center' }}
        >
          {(plan?.days || [])
            .filter(Boolean)
            .map((d, i) => {
              const active = i === dayIndex;
              return (
                <View
                  key={String(d?.id ?? i)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginHorizontal: 4,
                  }}
                >
                  <Pressable
                    onPress={() => changeDayTo(i)}
                    style={[styles.dayChip, active && styles.dayChipActive]}
                  >
                    <Text
                      style={[
                        styles.dayChipText,
                        active && styles.dayChipTextActive,
                      ]}
                    >
                      {`Gün ${i + 1}`} • {formatDate(d.date)}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      Alert.alert(`Gün ${i + 1}`, 'İşlem seçin', [
                        {
                          text: 'Tarihi Ayarla',
                          onPress: () => {
                            const cur =
                              toISODateSafe(plan?.days?.[i]?.date) ||
                              toISODateSafe(new Date());
                            setDatePickIndex(i);
                            setDatePickValue(new Date(cur));
                            setDatePickOpen(true);
                          },
                        },
                        {
                          text: 'Günü Sil',
                          style: 'destructive',
                          onPress: () => deleteDayAt(i),
                        },
                        { text: 'Vazgeç', style: 'cancel' },
                      ]);
                    }}
                    hitSlop={10}
                    style={{ padding: 6, marginLeft: -2 }}
                  >
                    <Ionicons
                      name="ellipsis-vertical"
                      size={16}
                      color={COLORS.fg}
                    />
                  </Pressable>
                </View>
              );
            })}

          <Pressable
            onPress={addEmptyDay}
            style={[styles.dayChip, { borderStyle: 'dashed', opacity: 0.9 }]}
          >
            <Text style={styles.dayChipText}>+ Gün</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.dayArrows}>
          <Pressable
            onPress={() => {
              mark('NEXT_DAY_PRESS');
              goNextDay();
            }}
            style={styles.dayArrowBtn}
          >
            <Ionicons name="caret-forward" size={18} color={COLORS.fg} />
          </Pressable>
        </View>
      </View>

      {/* İçerik alanı */}
      <View style={styles.content}>
        {/* Sol Panel (SideTimeline) */}
        <View
          style={[
            styles.side,
            {
              width: panelVisible ? LEFT_OPEN_W : LEFT_CLOSED_W,
              elevation: panelVisible ? 4 : 0,
              zIndex: panelVisible ? 2 : 0,
            },
            !panelVisible && { pointerEvents: 'none' },
          ]}
        >
          {(!day?.activities || day.activities.length === 0) && (
            <View
              style={{
                padding: 10,
                borderBottomWidth: 0.5,
                borderColor: COLORS.border,
              }}
            >
              <TouchableOpacity
                onPress={() => {
                  setInsertIndex(0);
                  setInsertMode(false);
                  setIsPanelOpen(false);
                  setSearchBarVisible(true);
                }}
                style={{
                  backgroundColor: COLORS.accent,
                  paddingVertical: 10,
                  alignItems: 'center',
                  borderRadius: 10,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>
                  Durak ekle
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <SideTimeline
            isOpen={panelVisible}
            plan={timelinePlan}
            dayIndex={dayIndex}
            setDayIndex={setDayIndex}
            onSelect={onTimelineItemPress}
            selectedActivityId={selectedActId}
            onInsertAt={(idx) => {
              const realUi =
                typeof idx === 'object' && idx !== null ? idx.index : idx;
              const realIdx = uiToReal(realUi);
              if (realIdx != null) {
                setInsertIndex(realIdx);
                setInsertMode(false);
                setIsPanelOpen(false);
                setSearchBarVisible(true);
                focusCorridorAround(realIdx);
              }
            }}
            onEditAt={handleStartEditAt}
            onDeleteAt={handleDeleteActivityAt}
            onReorder={(fromUi, toUi) => {
              const fromIndex =
                typeof fromUi === 'object' && fromUi !== null
                  ? fromUi.index
                  : fromUi;
              const toIndex =
                typeof toUi === 'object' && toUi !== null ? toUi.index : toUi;

              if (guardAnchorAction(fromIndex) || guardAnchorAction(toIndex))
                return;

              const from = uiToReal(fromIndex);
              const to = uiToReal(toIndex);
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

              setRouteData(null);
              setRouteSheetOpen(false);
            }}
            insertMode={insertMode}
            onPickInsertIndex={(uiIdx) => {
              const realUi =
                typeof uiIdx === 'object' && uiIdx !== null
                  ? uiIdx.index
                  : uiIdx;
              const real = uiToReal(realUi);
              if (real != null) onPickInsertIndex(real);
            }}
            onCancelInsertMode={onCancelInsertMode}
            onPickLeg={pickLeg}
            startAnchor={
              anchorInfo.start
                ? { label: anchorInfo.startLabel, location: anchorInfo.start }
                : null
            }
            endAnchor={
              anchorInfo.end
                ? { label: anchorInfo.endLabel, location: anchorInfo.end }
                : null
            }
            lodgingAnchor={
              anchorInfo.lodge
                ? { label: 'Konaklama', location: anchorInfo.lodge }
                : null
            }
            anchorLabels={{
              start: anchorInfo.startLabel,
              end: anchorInfo.endLabel,
              lodging: 'Konaklama',
            }}
            onPickStartLeg={(toIndex) => {
              const fromLoc = anchorInfo.start;
              const toAct = day?.activities?.[toIndex];
              const toLoc = toAct?.place?.location;
              if (fromLoc && toLoc) {
                const startName = anchorInfo.startLabel || 'Başlangıç';
                const destName =
                  getActName(toAct, toIndex) || `Durak ${toIndex + 1}`;

                setRouteLegLabel(`${startName} → ${destName}`);

                const wps = [
                  { lat: fromLoc.lat, lng: fromLoc.lon },
                  { lat: toLoc.lat, lng: toLoc.lon },
                ];
                setLegWaypoints(wps);

                const fitCoords = wps.map((p) => ({
                  latitude: p.lat,
                  longitude: p.lng,
                }));
                setRouteData({
                  polylineCoords: fitCoords,
                  distanceText: '',
                  durationText: '',
                });

                setIsPanelOpen(false);
                setRouteSheetOpen(true);

                if (mapRef.current) {
                  try {
                    mapRef.current.fitToCoordinates(fitCoords, {
                      edgePadding: { top: 80, right: 80, bottom: 280, left: 80 },
                      animated: true,
                    });
                  } catch {}
                }
              }
            }}
            onPickEndLeg={(fromIndex) => {
              const fromAct = day?.activities?.[fromIndex];
              const fromLoc = fromAct?.place?.location;
              const toLoc = anchorInfo.end;
              if (fromLoc && toLoc) {
                const endName = anchorInfo.endLabel || 'Bitiş';
                const fromName =
                  getActName(fromAct, fromIndex) || `Durak ${fromIndex + 1}`;

                setRouteLegLabel(`${fromName} → ${endName}`);

                const wps = [
                  { lat: fromLoc.lat, lng: fromLoc.lon },
                  { lat: toLoc.lat, lng: toLoc.lon },
                ];

                const fitCoords = wps.map((p) => ({
                  latitude: p.lat,
                  longitude: p.lng,
                }));
                setRouteData({
                  polylineCoords: fitCoords,
                  distanceText: '',
                  durationText: '',
                });

                setIsPanelOpen(false);
                setRouteSheetOpen(true);

                if (mapRef.current) {
                  try {
                    mapRef.current.fitToCoordinates(fitCoords, {
                      edgePadding: { top: 80, right: 80, bottom: 280, left: 80 },
                      animated: true,
                    });
                  } catch {}
                }
              }
            }}
            onPickLodgingLeg={(side, index) => {
              const lodge = anchorInfo.lodge;
              const act = day?.activities?.[index];
              const actLoc = act?.place?.location;
              if (lodge && actLoc) {
                const lodgeName = 'Konaklama';
                const actName = getActName(act, index) || `Durak ${index + 1}`;

                setRouteLegLabel(
                  side === 'before'
                    ? `${actName} → ${lodgeName}`
                    : `${lodgeName} → ${actName}`
                );

                const wps =
                  side === 'before'
                    ? [
                        { lat: actLoc.lat, lng: actLoc.lon },
                        { lat: lodge.lat, lng: lodge.lon },
                      ]
                    : [
                        { lat: lodge.lat, lng: lodge.lon },
                        { lat: actLoc.lat, lng: actLoc.lon },
                      ];
                setLegWaypoints(wps);

                const fitCoords = wps.map((p) => ({
                  latitude: p.lat,
                  longitude: p.lng,
                }));
                setRouteData({
                  polylineCoords: fitCoords,
                  distanceText: '',
                  durationText: '',
                });

                setIsPanelOpen(false);
                setRouteSheetOpen(true);

                if (mapRef.current) {
                  try {
                    mapRef.current.fitToCoordinates(fitCoords, {
                      edgePadding: { top: 80, right: 80, bottom: 280, left: 80 },
                      animated: true,
                    });
                  } catch {}
                }
              }
            }}
            onPickLegPair={logic.onPickLegPair}
          />
        </View>

        {/* Toggle & Arama Barı */}
        <View style={styles.toggleOverlay} pointerEvents="box-none">
          {searchBarVisible && (
            <View style={styles.searchBarWrap} pointerEvents="box-none">
              <View style={styles.searchBar}>
                <Ionicons name="search" size={16} color="#111" />
                <TextInput
                  style={styles.searchInput}
                  value={mapSearchQ}
                  onChangeText={setMapSearchQ}
                  placeholder="Haritada ara..."
                  placeholderTextColor="#6B7280"
                  autoFocus
                />
                {!!searchMarkers.length && !searchBusy && (
                  <TouchableOpacity
                    onPress={fitToSearchResults}
                    style={{
                      paddingHorizontal: 10,
                      backgroundColor: '#E5E7EB',
                      borderRadius: 8,
                      marginRight: 6,
                    }}
                  >
                    <Text style={{ fontWeight: '800' }}>Git</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => {
                    setMapSearchQ('');
                    setSearchMarkers([]);
                    setSearchBarVisible(false);
                  }}
                  style={styles.searchCloseBtn}
                >
                  <Ionicons name="close" size={16} color="#111" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={[styles.panelToggleWrapper, { left: toggleLeft }]}>
            <Pressable
              style={styles.panelToggleHitZone}
              onPress={onTogglePanel}
            >
              <View style={styles.panelToggle}>
                <Ionicons
                  name={panelVisible ? 'chevron-back' : 'chevron-forward'}
                  size={18}
                  color="#000"
                />
              </View>
            </Pressable>
          </View>
        </View>

        {/* Harita */}
        <View
          style={[
            styles.mapWrap,
            {
              width:
                Dimensions.get('window').width -
                (panelVisible ? LEFT_OPEN_W : LEFT_CLOSED_W),
            },
          ]}
        >
          {DEBUG_DISABLE_MAP_RENDER ? (
            <View
              style={[
                styles.map,
                { alignItems: 'center', justifyContent: 'center' },
              ]}
            >
              <Text style={{ color: COLORS.fg, opacity: 0.8 }}>
                [DBG] Map render kapalı (DEBUG_DISABLE_MAP_RENDER)
              </Text>
            </View>
          ) : (
            <MapView
              ref={mapRef}
              style={styles.map}
              pointerEvents="auto"
              showsPointsOfInterest={true}
              onLongPress={handleMapLongPress}
              onRegionChangeComplete={onMapRegionChanged}
              initialRegion={{
                latitude: 39.93,
                longitude: 32.86,
                latitudeDelta: 0.15,
                longitudeDelta: 0.15,
              }}
            >
              {searchMarkers.map((sm) => (
                <Marker
                  key={`srch-${sm.id}`}
                  coordinate={sm.coord}
                  title={sm.title}
                  pinColor="#111827"
                  onPress={() => onSelectSearchResult(sm)}
                />
              ))}

              {routeData?.polylineCoords?.length ? (
                <Polyline
                  coordinates={routeData.polylineCoords}
                  strokeWidth={6}
                  strokeColor="#60A5FA"
                  zIndex={2}
                />
              ) : routeSheetOpen ? null : !DEBUG_DISABLE_SEGMENT_POLYLINES &&
                segments.length ? (
                segments.map((s, idx) => (
                  <Polyline
                    key={`seg-${idx}`}
                    coordinates={s.coords}
                    strokeWidth={5}
                    strokeColor={s.ok ? undefined : '#888'}
                    zIndex={0}
                    onPress={() => {
                      setRouteData({ polylineCoords: s.coords });
                      setRouteSheetOpen(true);
                    }}
                    tappable
                  />
                ))
              ) : null}

              {mapMarkers.map((m) => (
                <Marker
                  key={m.key}
                  ref={(ref) => (logic.markerRefs.current[m.activityId] = ref)}
                  coordinate={m.coordinate}
                  title={m.title}
                  anchor={{ x: 0.5, y: 1 }}
                  zIndex={10}
                  onPress={() => onMapMarkerPress(m.activityId)}
                >
                  <NumMarker
                    bg={m.activityId === selectedActId ? '#FF7A00' : m.baseColor}
                    order={m.order}
                  />
                </Marker>
              ))}
            </MapView>
          )}
        </View>
      </View>

      {/* Quick Card */}
      {DEBUG_DISABLE_QUICKCARD ? null : (
        <View style={styles.quickLayer} pointerEvents="box-none">
          <PlaceQuickCard
            visible={!!normalizedSheetMarker}
            marker={normalizedSheetMarker}
            variant={sheetVariant}
            metaLabel={sheetMeta}
            onDismiss={() => setSheetMarker(null)}
            onCtaPress={handleQuickCardCta}
          />
        </View>
      )}

      {/* Route Sheet */}
      {DEBUG_DISABLE_ROUTE_SHEET ? null : (
        <TripRouteSheet
          visible={routeSheetOpen}
          waypoints={legWaypoints}
          apiKey={DIRECTIONS_API_KEY}
          preferredMode="driving"
          previewData={routeData}
          legLabel={routeLegLabel}
          previewTitle={
            legActs?.a && legActs?.b
              ? `${getActName(legActs.a, legSel?.from ?? 0)} → ${getActName(
                  legActs.b,
                  legSel?.to ?? 0
                )}`
              : undefined
          }
          onRouteData={(rd) => {
            if (rd) setRouteData(rd);
            else setRouteData(null);
          }}
          onClose={() => {
            setRouteSheetOpen(false);
            setRouteData(null);
            setRouteLegLabel('');
            setIsPanelOpen(true);
          }}
          onStart={async ({ mode }) => {
            const ok = await ensureLocationBeforeStart();
            if (!ok) return;
            setRouteSheetOpen(false);

            try {
              const b = legActs?.b;
              if (!b?.place?.location) return;

              let curLoc = null;
              try {
                curLoc = await Location.getCurrentPositionAsync({
                  accuracy: Location.Accuracy.Balanced,
                });
              } catch {}
              if (!curLoc) {
                Alert.alert('Hata', 'Konum alınamadı');
                return;
              }

              const la = {
                lat: curLoc.coords.latitude,
                lng: curLoc.coords.longitude,
              };
              const lb = b.place.location;

              const nameB = getActName(b, legSel?.to ?? 0);
              const pidB = extractPossiblePlaceIdFromActivity(b);

              navigateToTurnByTurn(navigation, {
                entryPoint: 'turn-by-turn',
                from: {
                  latitude: la.lat,
                  longitude: la.lng,
                  name: 'Mevcut Konum',
                },
                to: {
                  latitude: lb.lat,
                  longitude: lb.lon || lb.lng,
                  name: nameB,
                  place_id: pidB,
                },
                mode: mode || 'driving',
              });
            } catch (e) {
              console.warn('Nav start err', e);
            }
          }}
        />
      )}

      {/* İzin Modalı */}
      <PermissionPromptModal
        visible={!!permissionPrompt}
        title={permissionPrompt?.title}
        message={permissionPrompt?.message}
        actions={permissionPrompt?.actions}
        onDismiss={() => setPermissionPrompt(null)}
      />

      {/* Tarih Seçimi */}
      {datePickOpen && (
        <Modal
          transparent
          animationType="fade"
          onRequestClose={() => setDatePickOpen(false)}
        >
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => setDatePickOpen(false)}
          />
          <View style={styles.calCard}>
            <Calendar
              initialDate={toISODateSafe(datePickValue)}
              onDayPress={(d) => {
                if (datePickIndex != null)
                  setDayDateAt(datePickIndex, d.dateString);
                setDatePickOpen(false);
              }}
              markedDates={{
                [toISODateSafe(datePickValue)]: { selected: true },
              }}
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
