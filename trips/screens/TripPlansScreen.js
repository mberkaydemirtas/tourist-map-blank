// /trips/screens/TripPlansScreen.js
import React, { useCallback } from 'react';
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
  isStrictPlaceId,
  getDetailsWithCache,
  coercePhotoInputsToUrls,
  limitPhotos,
  extractPossiblePlaceIdFromActivity,
  navigateToTurnByTurn,
} from '../components/TripPlanHelpers';

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

export default function TripPlansScreen({ route, navigation }) {
  const { tripId } = route.params || {};
  const insets = useSafeAreaInsets();

  // 1️⃣ TÜM MANTIK HOOK İÇİNDEN ÇAĞRILIYOR
  const logic = useTripPlansLogic({ tripId, navigation, route });

  // Hook'tan dönen verileri parçalayalım
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

  // ✅ QuickCard açıksa sol paneli tamamen gizleyelim
  const panelVisible = isPanelOpen && !sheetMarker;
  const toggleLeft = panelVisible
    ? LEFT_OPEN_W - TOGGLE_SIZE / 2 + 8
    : -TOGGLE_SIZE / 2 + TOGGLE_PEEK;

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
      setSheetMeta('');

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
      const c = markerLike?.coords;

      // Hem photoUrls hem photos'tan normalize et
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

      const sel = {
        key:
          markerLike?.place_id ||
          `map:${Math.round((c?.latitude ?? 0) * 1e6)}_${Math.round(
            (c?.longitude ?? 0) * 1e6
          )}`,
        description: markerLike?.name || 'Seçilen konum',
        coords: c,
        address: markerLike?.address || '',
        photoUrls: mergedPhotoUrls,
      };

      setSheetMarker(null);

      if (editIndex != null) {
        // Düzenleme Modu
        mutatePlanDays((next) => {
          const d = next.days?.[dayIndex];
          if (!d) return;
          const arr = d.activities || [];
          if (editIndex < 0 || editIndex >= arr.length) return;

          const id = sel.key || `tmp:${Date.now()}`;
          const act = {
            id,
            type: 'visit',
            durationMin: 45,
            place: {
              id,
              name: sel.description || 'Seçilen yer',
              location: sel.coords
                ? {
                    lat: sel.coords.latitude,
                    lon: sel.coords.longitude,
                  }
                : null,
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
      } else {
        // Ekleme Modu
        const len = day?.activities?.length || 0;
        const pickIndex = (() => {
          if (!len) return 0;
          if (typeof insertIndex === 'number')
            return Math.min(Math.max(insertIndex, 0), len);
          if (
            typeof logic.focusIdx === 'number' &&
            logic.focusIdx >= 0 &&
            logic.focusIdx <= len - 1
          ) {
            return Math.min(logic.focusIdx + 1, len);
          }
          return len;
        })();
        addResolvedAtIndex(pickIndex, sel);
      }

      setPendingAdd(null);
      setInsertMode(false);
      setIsPanelOpen(true);
      setSearchBarVisible(false);
      setInsertIndex(null);
      setMapSearchQ('');
      setSearchMarkers([]);
    },
    [
      editIndex,
      dayIndex,
      mutatePlanDays,
      retimeDay,
      rebuildPolyline,
      setSelectedActId,
      setSheetMarker,
      setEditIndex,
      day?.activities?.length,
      insertIndex,
      logic.focusIdx,
      addResolvedAtIndex,
      setPendingAdd,
      setInsertMode,
      setIsPanelOpen,
      setSearchBarVisible,
      setInsertIndex,
      setMapSearchQ,
      setSearchMarkers,
    ]
  );

  // Arama Sonucuna Git
  const fitToSearchResults = useCallback(() => {
    if (!mapRef.current || !searchMarkers.length) return;
    const coords = searchMarkers.map((s) => s.coord);
    try {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 80, bottom: 200, left: 80 },
        animated: true,
      });
    } catch {}
  }, [searchMarkers]);

  // Helper: Aktivite Silme (SideTimeline için)
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

  // Helper: Edit Başlatma
  const handleStartEditAt = useCallback(
    (uiIdx) => {
      if (guardAnchorAction(uiIdx)) return;
      const realIdx = uiToReal(uiIdx);
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

  // QuickCard’a giden marker'ı normalize et (foto alanları için)
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
          <Pressable onPress={goPrevDay} style={styles.dayArrowBtn}>
            <Ionicons name="caret-back" size={18} color={COLORS.fg} />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingRight: 10,
            alignItems: 'center',
          }}
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
                    onPress={() => setDayIndex(i)}
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
          <Pressable onPress={goNextDay} style={styles.dayArrowBtn}>
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
            plan={{
              ...plan,
              days: plan.days.map((d, i) =>
                i === dayIndex ? { ...d, activities: uiActivities } : d
              ),
            }}
            dayIndex={dayIndex}
            setDayIndex={setDayIndex}
            onSelect={onTimelineItemPress}
            selectedActivityId={selectedActId}
            onInsertAt={(idx) => {
              const real = typeof idx === 'object' ? idx.index : idx;
              const realIdx = uiToReal(real);
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
            }}
            insertMode={insertMode}
            onPickInsertIndex={(uiIdx) => {
              const real = uiToReal(uiIdx);
              if (real != null) onPickInsertIndex(real);
            }}
            onCancelInsertMode={onCancelInsertMode}
            onPickLeg={pickLeg}
            // Anchor Leg İşlemleri
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

                // Haritada hemen düz çizgi çiz
                const fitCoords = wps.map((p) => ({
                  latitude: p.lat,
                  longitude: p.lng,
                }));
                setRouteData({
                  polylineCoords: fitCoords,
                  distanceText: '',
                  durationText: '',
                });

                // Side paneli kapat & rota sheet'i aç
                setIsPanelOpen(false);
                setRouteSheetOpen(true);

                // Haritayı bacak etrafına zoom
                if (mapRef.current) {
                  try {
                    mapRef.current.fitToCoordinates(fitCoords, {
                      edgePadding: {
                        top: 80,
                        right: 80,
                        bottom: 280,
                        left: 80,
                      },
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
                      edgePadding: {
                        top: 80,
                        right: 80,
                        bottom: 280,
                        left: 80,
                      },
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
                const actName =
                  getActName(act, index) || `Durak ${index + 1}`;

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
                      edgePadding: {
                        top: 80,
                        right: 80,
                        bottom: 280,
                        left: 80,
                      },
                      animated: true,
                    });
                  } catch {}
                }
              }
            }}
            // Hook'tan gelen fonksiyon
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
          <MapView
            ref={mapRef}
            style={styles.map}
            pointerEvents="auto"
            showsPointsOfInterest={true}
            // onPoiClick={handlePoiClick}  // şimdilik devre dışı
            onLongPress={handleMapLongPress}
            onRegionChangeComplete={onMapRegionChanged}
            initialRegion={{
              latitude: 39.93,
              longitude: 32.86,
              latitudeDelta: 0.15,
              longitudeDelta: 0.15,
            }}
          >
            {/* Arama Sonuçları */}
            {searchMarkers.map((sm) => (
              <Marker
                key={`srch-${sm.id}`}
                coordinate={sm.coord}
                title={sm.title}
                pinColor="#111827"
                onPress={() => onSelectSearchResult(sm)}
              />
            ))}

            {/* Rota Çizgileri */}
            {routeData?.polylineCoords?.length ? (
              <Polyline
                coordinates={routeData.polylineCoords}
                strokeWidth={6}
                strokeColor="#60A5FA"
                zIndex={2}
              />
            ) : routeSheetOpen ? null : segments.length ? (
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

            {/* Aktivite Markerları */}
            {mapMarkers.map((m) => (
              <Marker
                key={m.key}
                ref={(ref) =>
                  (logic.markerRefs.current[m.activityId] = ref)
                }
                coordinate={m.coordinate}
                title={m.title}
                anchor={{ x: 0.5, y: 1 }}
                zIndex={10}
                onPress={() => onMapMarkerPress(m.activityId)}
              >
                <NumMarker
                  bg={
                    m.activityId === selectedActId
                      ? '#FF7A00'
                      : m.baseColor
                  }
                  order={m.order}
                />
              </Marker>
            ))}
          </MapView>
        </View>
      </View>

      {/* Quick Card */}
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

      {/* Route Sheet */}
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
          // sadece seçilen rota çizilsin
          if (rd) {
            setRouteData(rd);
          } else {
            setRouteData(null);
          }
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
 