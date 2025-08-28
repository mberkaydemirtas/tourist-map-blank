// src/MapScreen.js
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  SafeAreaView,
  Platform,
  TouchableOpacity,
  Text,
} from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { InteractionManager } from 'react-native';

import { useLocation } from './hooks/useLocation';
import { useMapLogic } from './hooks/useMapLogic';
import MapHeaderControls from './components/MapHeaderControls';
import MapOverlays from './components/MapOverlays';
import CategoryList from './components/CategoryList';
import GetDirectionsOverlay from './components/GetDirectionsOverlay';
import NavigationBanner from './components/NavigationBanner';
import AddStopOverlay from './components/AddStopOverlay';
import EditStopsOverlay from './components/EditStopsOverlay2';

import { normalizeCoord, toCoordsObject } from './utils/coords';
import { reverseGeocode, getPlaceDetails, getNearbyPlaces, autocomplete } from './maps';

import { useRouteSheetController } from './hooks/useRouteSheetController';
import { useHistoryMigration } from './hooks/useHistoryMigration';
import { useRouteCompute } from './hooks/useRouteCompute';
import { History, HISTORY_KEYS, migrateLegacy, pushLabelHistoryCompat as pushLabelHistory } from './utils/history';

import PlaceDetailSheetContainer from './containers/PlaceDetailSheetContainer';
import RouteInfoSheetContainer from './containers/RouteInfoSheetContainer';

import ExploreLayer from './layers/ExploreLayer';
import RouteLayer from './layers/RouteLayer';
import PoiAlongRouteLayer from './layers/PoiAlongRouteLayer';

import RouteFormPanel from './components/RouteFormPanel';
import RouteFabControls from './components/RouteFabControls';
import { useBackBehavior } from './hooks/useBackBehavior';

// ✅ Yeni hooklar (4 ve 5)
import { useRoutePrefetch } from './hooks/useRoutePrefetch';
import { usePoiAlongRoute } from './hooks/usePoiAlongRoute';

// ✅ Ayrıştırdığımız yeni hooklar
import { useFromToSelection } from './hooks/useFromToSelection';
import { useStopsEditor } from './hooks/useStopsEditor';
import { useRouteCancel } from './hooks/useRouteCancel';

/* ------------------------- küçük yardımcılar ------------------------- */
const xlog = (...a) => console.log('%c[XRAY] ', 'color:#ff3b30', ...a);

export default function MapScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const picker = route.params?.picker?.enabled ? route.params.picker : null; // { enabled, which: 'start'|'end'|'lodging'... }
  const mapRef = useRef(null);
  const map = useMapLogic(mapRef);
  const { coords, available, refreshLocation } = useLocation();
  const isPlaceSheetOpenRef = useRef(false);

  // sheets
  const sheetRef = useRef(null);
  const sheetRefRoute = useRef(null);
  const {
    present: presentRouteSheet,
    dismiss: dismissRouteSheet,
    presentedRef: routeSheetPresentedRef,
    resumeAfterNavRef: resumeSheetAfterNavRef,
  } = useRouteSheetController(sheetRefRoute);

  const handleModeRequest = async (mode) => {
    map.setSelectedMode(mode);
    const hasData = Array.isArray(map.routeOptions?.[mode]) && map.routeOptions[mode].length > 0;
    if (hasData) return;
    const f = normalizeCoord(map.fromLocation?.coords);
    const t = normalizeCoord(map.toLocation?.coords);
    if (!f || !t) return;
    try { await recalcRoute(mode, null, f, t); }
    catch (e) { console.warn('❌ Mode request hesaplama hatası:', e); }
  };

  // UI
  const [mode, setMode] = useState('explore');
  const [canShowScan, setCanShowScan] = useState(false);
  const [mapMovedAfterDelay, setMapMovedAfterDelay] = useState(false);
  const [showFromOverlay, setShowFromOverlay] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayContext, setOverlayContext] = useState(null); // 'from' | 'to'
  const [isSelectingFromOnMap, setIsSelectingFromOnMap] = useState(false);
  const [showSelectionHint, setShowSelectionHint] = useState(false);

  // route
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);

  // (optional) nav banner
  const [isNavigating, setIsNavigating] = useState(false);
  const [firstManeuver, setFirstManeuver] = useState(null);

  useHistoryMigration();

  // ✅ 5. adım: POI koridoru hook'u
  const {
    candidateStop, setCandidateStop,
    poiMarkers, setPoiMarkers,
    stablePoiList,
    fetchPlacesAlongRoute,
    onPoiPress,
  } = usePoiAlongRoute(routeCoords, mapRef);

  const markerRefs = useRef(new Map());
  const setMarkerRef = useCallback((id, ref) => {
    if (ref) markerRefs.current.set(id, ref);
    else markerRefs.current.delete(id);
  }, []);

  const routeBounds = useMemo(() => {
    if (!Array.isArray(routeCoords) || routeCoords.length < 2) return null;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const c of routeCoords) {
      const lat = c.latitude ?? c.lat;
      const lng = c.longitude ?? c.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    const pad = 0.02;
    return { sw: { lat: minLat - pad, lng: minLng - pad }, ne: { lat: maxLat + pad, lng: maxLng + pad } };
  }, [routeCoords]);

  /* -------------------------- MIGRASYON -------------------------- */
  useEffect(() => {
    if (picker?.which === 'lodging') {
      try { sheetRef.current?.snapToIndex?.(1); } catch {}
    }
  }, [picker]);

  useFocusEffect(
    React.useCallback(() => {
      if (mode === 'route' && resumeSheetAfterNavRef.current) {
        const list = map.routeOptions?.[map.selectedMode] || [];
        const primary = (list.find(r => r.isPrimary) || list[0]);
        const hasRoute = !!(primary && primary.decodedCoords && primary.decodedCoords.length > 0);
        if (hasRoute) {
          InteractionManager.runAfterInteractions(() => { presentRouteSheet(); });
        }
        resumeSheetAfterNavRef.current = false;
      }
    }, [mode, map.selectedMode, map.routeOptions, presentRouteSheet])
  );

  // Wizard'dan picker.center geldiyse o şehrin merkezine zoomla
  useEffect(() => {
    const c = picker?.center ? normalizeCoord(picker.center) : null;
    if (c && mapRef.current) {
      const region = { ...c, latitudeDelta: 0.08, longitudeDelta: 0.08 };
      map.setRegion(region);
      mapRef.current.animateToRegion(region, 500);
    }
  }, [picker?.center]);

  // Rota hesaplama & prefetch
  const { recalcRoute, prefetchMissingModes } = useRouteCompute({
    map, mapRef, normalizeCoord, presentRouteSheet,
  });

  // ✅ FROM/TO seçimi ve haritadan seçim hook'u
  const {
    onGetDirectionsPress,
    handleFromSelected,
    handleToSelected,
    handleSelectOriginOnMap,
    handleSelectDestinationOnMap,
    handleMapPress,
    handleReverseRoute,
  } = useFromToSelection({
    map,
    mapRef,
    setMode,
    sheetRef,
    normalizeCoord,
    toCoordsObject,
    reverseGeocode,
    getPlaceDetails,
    recalcRoute,
    overlayContext,
    setShowFromOverlay,
    setIsSelectingFromOnMap,
    setShowSelectionHint,
    History,
    HISTORY_KEYS,
    pushLabelHistory,
  });

  // ✅ Çoklu durak düzenleme hook'u
  const {
    addStopOpen, setAddStopOpen,
    editStopsOpen, setEditStopsOpen,
    draftStops, setDraftStops,
    pendingEditOp, setPendingEditOp,
    openEditStops,
    handleAddStopFlexible,
    handlePickStop,
    confirmEditStops,
    onDragEnd,
    onDelete,
    onInsertAt,
    onReplaceAt,
  } = useStopsEditor({
    map,
    recalcRoute,
    setMode,
    candidateStop,
    setCandidateStop,
    setPoiMarkers,
    History,
    HISTORY_KEYS,
    getPlaceDetails,
    autocomplete,
  });

  // ✅ Rota iptal/temizlik hook'u
  const { handleCancelRoute } = useRouteCancel({
    setMode,
    map,
    setCandidateStop,
    setPoiMarkers,
    setRouteCoords,
    setRouteInfo,
    dismissRouteSheet,
    routeSheetPresentedRef,
  });

  // ✅ Eksik modları prefetch eden hook
  useRoutePrefetch({ mode, map, normalizeCoord, prefetchMissingModes });

  /* -------------------------- KAMERA / UI -------------------------- */
  useBackBehavior({
    mode,
    placeSheetOpenRef: isPlaceSheetOpenRef,
    placeSheetRef: sheetRef,
    routeSheetPresentedRef,
    dismissRouteSheet,
    handleCancelRoute,
  });

  useEffect(() => {
    if (map.categoryMarkers.length > 0) {
      const cs = map.categoryMarkers
        .map(item => normalizeCoord(item?.coords ?? item?.coordinate ?? item?.geometry?.location ?? item))
        .filter(Boolean);
      let t;
      if (cs.length > 0) {
        t = setTimeout(() => {
          mapRef.current?.fitToCoordinates(cs, {
            edgePadding: { top: 100, bottom: 300, left: 100, right: 100 },
            animated: true,
          });
        }, 500);
      }
      return () => t && clearTimeout(t);
    }
  }, [map.categoryMarkers]);

  // Explore sheet davranışları (mevcut)
  useEffect(() => {
    if (mode !== 'explore') return;
    if (map.fromLocation) return;
    if (!map.marker) return;
    const id = requestAnimationFrame(() => { sheetRef.current?.snapToIndex?.(0); });
    return () => cancelAnimationFrame(id);
  }, [mode, map.fromLocation, map.marker]);

  useEffect(() => {
    if (mode === 'explore' && !map.fromLocation) return;
    sheetRef.current?.close?.();
  }, [mode, map.fromLocation]);

  useEffect(() => {
    if (mode !== 'explore') return;
    if (map.fromLocation) return;
    if (map.marker) return;
    sheetRef.current?.close?.();
  }, [mode, map.fromLocation, map.marker]);

  const lastAvailable = useRef(false);
  useEffect(() => {
    if (!lastAvailable.current && available && coords && mapRef.current) {
      const region = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      requestAnimationFrame(() => {
        map.setRegion(region);
        mapRef.current.animateToRegion(region, 500);
      });
    }
    lastAvailable.current = available;
  }, [available, coords]);

  useEffect(() => {
    setCanShowScan(false);
    setMapMovedAfterDelay(false);
    if (map.activeCategory) {
      const timer = setTimeout(() => setCanShowScan(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [map.activeCategory]);

  const onRegionChangeComplete = region => {
    map.setRegion(region);
    if (canShowScan) setMapMovedAfterDelay(true);
  };

  useEffect(() => {
    if (mode !== 'route') return;
    const list = map.routeOptions?.[map.selectedMode];
    xlog('MS.routeOptions watch', {
      mode, selMode: map.selectedMode,
      count: Array.isArray(list) ? list.length : 0,
      firstPts: (list?.[0]?.decodedCoords?.length ?? 0)
    });
    if (!Array.isArray(list) || list.length === 0) return;

    const primary = list.find(r => r.isPrimary) ?? list[0];
    if (primary?.decodedCoords?.length) {
      setRouteCoords(primary.decodedCoords);
      setRouteInfo({ distance: primary.distance, duration: primary.duration });
      mapRef.current?.fitToCoordinates(primary.decodedCoords, {
        edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
        animated: true,
      });
      const allReady = ['driving','walking','transit'].every(
        m => Array.isArray(map.routeOptions?.[m]) && map.routeOptions[m].length > 0
      );
      if (allReady || routeSheetPresentedRef.current) {
        requestAnimationFrame(presentRouteSheet);
      }
    }
  }, [mode, map.selectedMode, map.routeOptions, presentRouteSheet]);

  useEffect(() => {
    if (mode !== 'route') return;
    const ready = Array.isArray(routeCoords) && routeCoords.length > 0;
    if (!ready) return;
    const allReady = ['driving','walking','transit'].every(
      m => Array.isArray(map.routeOptions?.[m]) && map.routeOptions[m].length > 0
    );
    if (allReady || routeSheetPresentedRef.current) {
      const id = setTimeout(() => presentRouteSheet(), 0);
      return () => clearTimeout(id);
    }
  }, [mode, routeCoords, map.routeOptions, presentRouteSheet]);

  // RoutePlannerCard -> Map geçişini karşıla
  useEffect(() => {
    const req = route?.params?.routeRequest;
    if (!req || !req.from || !req.to) return;

    const fromC = normalizeCoord(req.from);
    const toC   = normalizeCoord(req.to);
    if (!fromC || !toC) return;

    setMode('route');
    map.setFromLocation({
      coords: fromC,
      description: req.from.name || 'Başlangıç',
      key: req.from.place_id || 'external',
    });
    map.setToLocation({
      coords: toC,
      description: req.to.name || 'Bitiş',
      key: req.to.place_id || 'external',
    });

    const wps = Array.isArray(req.waypoints)
      ? req.waypoints
          .map(w => {
            const lat = w.lat ?? w.latitude ?? w?.coords?.latitude ?? w?.location?.lat;
            const lng = w.lng ?? w.longitude ?? w?.coords?.longitude ?? w?.location?.lng;
            return { lat, lng, name: w.name, address: w.address, place_id: w.place_id || w.id || null };
          })
          .filter(w => Number.isFinite(w.lat) && Number.isFinite(w.lng))
      : [];

    map.setWaypoints(wps);
    if (req.mode) map.setSelectedMode(req.mode);

    const toFit = [
      { latitude: fromC.latitude, longitude: fromC.longitude },
      ...wps.map(w => ({ latitude: w.lat, longitude: w.lng })),
      { latitude: toC.latitude,   longitude: toC.longitude },
    ];
    requestAnimationFrame(() => {
      if (mapRef.current && toFit.length >= 2) {
        mapRef.current.fitToCoordinates(toFit, {
          edgePadding: { top: 60, right: 60, bottom: 220, left: 60 },
          animated: true,
        });
      }
    });

    setTimeout(() => { recalcRoute(req.mode, wps, fromC, toC); }, 0);

    navigation.setParams({ routeRequest: undefined });
  }, [route?.params?.routeRequest, navigation, recalcRoute, map.setFromLocation, map.setToLocation, map.setWaypoints, map.setSelectedMode]);

  /* --------------------------------- RENDER --------------------------------- */
  return (
    <View style={styles.container}>
      <MapView
        key={`cat-${map.categoryMarkers.length}`}
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={map.region}
        onPress={handleMapPress}
        onPanDrag={() => { if (showSelectionHint) setShowSelectionHint(false); }}
        onRegionChangeComplete={onRegionChangeComplete}
        scrollEnabled
        zoomEnabled
        rotateEnabled
        pitchEnabled
        onPoiClick={(e) => {
          if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'from') {
            handleSelectOriginOnMap(e.nativeEvent.coordinate);
            return;
          }
          if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'to') {
            handleSelectDestinationOnMap(e.nativeEvent.coordinate);
            return;
          }
          map.handlePoiClick(e, {
            showOverlay: showOverlay,
            showFromOverlay: showFromOverlay,
            closeOverlays: () => { setShowOverlay(false); setShowFromOverlay(false); },
          });
        }}
        showsUserLocation={available}
      >
        {/* Layers */}
        <ExploreLayer active={mode === 'explore'} map={map} />
        <RouteLayer
          active={mode === 'route'}
          map={map}
          candidateStop={candidateStop}
          onAddStopFlexible={handleAddStopFlexible}
          onRouteSelected={(selected) => {
            const updated = (map.routeOptions[map.selectedMode] || [])
              .map(r => ({ ...r, isPrimary: r.id === selected.id }));
            map.setRouteOptions(prev => ({ ...prev, [map.selectedMode]: updated }));
            setRouteCoords(selected.decodedCoords);
            setRouteInfo({ distance: selected.distance, duration: selected.duration });
            mapRef.current?.fitToCoordinates(selected.decodedCoords, {
              edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
              animated: true,
            });
            requestAnimationFrame(presentRouteSheet);
          }}
          styles={styles}
        />
        <PoiAlongRouteLayer
          list={stablePoiList}
          setMarkerRef={setMarkerRef}
          onPoiPress={onPoiPress}
          onAddStop={handleAddStopFlexible}
          styles={styles}
        />
      </MapView>

      {/* Haritadan seçim uyarısı */}
      {showSelectionHint && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={styles.transparentOverlay} pointerEvents="none" />
          <View style={styles.selectionPromptContainer} pointerEvents="none">
            <Text style={styles.selectionPromptText}>Haritaya dokunarak bir konum seçin</Text>
          </View>
        </View>
      )}

      <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        {/* EXPLORE üst kontroller */}
        {mode === 'explore' && (
          <>
            <MapHeaderControls
              query={map.query}
              onQueryChange={map.setQuery}
              onPlaceSelect={map.handleSelectPlace}
              onCategorySelect={map.handleCategorySelect}
              mapMovedAfterDelay={mapMovedAfterDelay}
              loadingCategory={map.loadingCategory}
              onSearchArea={map.handleSearchThisArea}
              activeCategory={map.activeCategory}
            />

            {map.activeCategory && map.categoryMarkers.length > 0 && (
              <CategoryList
                data={map.categoryMarkers}
                activePlaceId={map.marker?.place_id}
                onSelect={map.handleSelectPlace}
                userCoords={coords}
              />
            )}
          </>
        )}

        {/* 📌 PlaceDetailSheet */}
        <PlaceDetailSheetContainer
          ref={sheetRef}
          map={map}
          picker={picker}
          navigation={navigation}
          onGetDirections={onGetDirectionsPress}
          onOpen={() => { isPlaceSheetOpenRef.current = true; }}
          onClose={() => { isPlaceSheetOpenRef.current = false; }}
        />

        {/* get directions – nereden overlay */}
        {showFromOverlay && (
          <GetDirectionsOverlay
            visible={showFromOverlay}
            userCoords={coords}
            available={available}
            refreshLocation={refreshLocation}
            historyKey="search_history"
            favoritesKey="favorite_places"
            onCancel={() => setShowFromOverlay(false)}
            onFromSelected={handleFromSelected}
            onMapSelect={() => {
              setShowFromOverlay(false);
              setMode('route');
              setOverlayContext('from');
              map.setFromLocation(null);
              setIsSelectingFromOnMap(true);
              setShowSelectionHint(true);
              if (map.marker) {
                map.setToLocation({ coords: map.marker.coordinate, description: map.marker.name });
              }
            }}
          />
        )}

        {/* ROUTE modunda nereden/nereye girişleri */}
        {mode === 'route' && (
          <RouteFormPanel
            styles={styles}
            fromLabel={map.fromLocation?.description}
            toLabel={map.toLocation?.description}
            onSwap={handleReverseRoute}
            onPickFrom={() => { setOverlayContext('from'); setShowOverlay(true); }}
            onPickTo={() => { setOverlayContext('to'); setShowOverlay(true); }}
          />
        )}

        {/* Ortak overlay */}
        {showOverlay && (
          <GetDirectionsOverlay
            visible={showOverlay}
            userCoords={coords}
            available={available}
            refreshLocation={refreshLocation}
            historyKey={`search_history_${overlayContext}`}
            favoritesKey={`favorite_places_${overlayContext}`}
            onCancel={() => setShowOverlay(false)}
            onFromSelected={
              overlayContext === 'from'
                ? (place) => { handleFromSelected(place); setShowOverlay(false); }
                : undefined
            }
            onToSelected={
              overlayContext === 'to'
                ? (place) => { handleToSelected(place); setShowOverlay(false); }
                : undefined
            }
            onMapSelect={() => {
              setShowOverlay(false);
              setIsSelectingFromOnMap(true);
            }}
          />
        )}

        {/* Route Info Sheet */}
        {xlog('MS.render RIS', {
          hasRef: !!sheetRefRoute.current,
          mode,
          dist: routeInfo?.distance, dur: routeInfo?.duration,
          routesCount: (map.routeOptions?.[map.selectedMode] || []).length
        }) || null}
        <RouteInfoSheetContainer
          ref={sheetRefRoute}
          distance={routeInfo?.distance}
          duration={routeInfo?.duration}
          map={map}
          snapPoints={['30%']}
          onCancel={handleCancelRoute}
          onModeChange={map.handleSelectRoute}
          onModeRequest={handleModeRequest}
          onStart={() => {
            resumeSheetAfterNavRef.current = true;
            dismissRouteSheet();

            const f = normalizeCoord(map.fromLocation?.coords);
            const t = normalizeCoord(map.toLocation?.coords);
            if (!f || !t) return;

            const wps = Array.isArray(map.waypoints)
              ? map.waypoints
                  .map(w => ({
                    lat: w.lat ?? w.latitude,
                    lng: w.lng ?? w.longitude,
                    name: w.name,
                    place_id: w.place_id ?? null,
                  }))
                  .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
              : [];

            const primary = (map.routeOptions?.[map.selectedMode] || []).find(r => r.isPrimary)
                         || (map.routeOptions?.[map.selectedMode] || [])[0];

            navigation.navigate('NavigationScreen', {
              entryPoint: 'turn-by-turn',
              from: { latitude: f.latitude, longitude: f.longitude, name: map.fromLocation?.description, place_id: map.fromLocation?.key || null },
              to:   { latitude: t.latitude, longitude: t.longitude, name: map.toLocation?.description, place_id: map.toLocation?.key || null },
              waypoints: wps,
              mode: map.selectedMode,
              polyline: primary?.polyline,
              steps: primary?.steps,
            });
          }}
        >
          <View style={styles.routeSheetHeader}>
            <TouchableOpacity onPress={handleCancelRoute} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        </RouteInfoSheetContainer>

        {mode === 'route' && (
          <RouteFabControls
            styles={styles}
            waypointsCount={(map.waypoints || []).length}
            onAddStop={() => setAddStopOpen(true)}
            onEditStops={openEditStops}
          />
        )}
      </SafeAreaView>

      {/* AddStopOverlay */}
      <AddStopOverlay
        visible={addStopOpen}
        onClose={() => { setAddStopOpen(false); setCandidateStop(null); setPoiMarkers([]); setPendingEditOp(null); }}
        onCategorySelect={async (type) => { await fetchPlacesAlongRoute({ type, noCorridor: false }); }}
        onQuerySubmit={async (text) => { await fetchPlacesAlongRoute({ text, noCorridor: true }); }}
        onPickStop={handlePickStop}
        onAddStop={handleAddStopFlexible}
        routeBounds={routeBounds}
        historyKey="route_stop_history"
        favoritesKey="route_stop_favorites"
      />

      {/* Durakları Düzenle */}
      <EditStopsOverlay
        visible={editStopsOpen}
        stops={draftStops}
        onClose={() => { setEditStopsOpen(false); setDraftStops([]); setPendingEditOp(null); }}
        onConfirm={confirmEditStops}
        onDragEnd={onDragEnd}
        onDelete={onDelete}
        onInsertAt={onInsertAt}
        onReplaceAt={onReplaceAt}
      />

      {/* opsiyonel nav banner */}
      {isNavigating && firstManeuver && (
        <NavigationBanner
          maneuver={firstManeuver}
          duration={routeInfo?.duration}
          distance={routeInfo?.distance}
          onCancel={handleCancelRoute}
        />
      )}

      {/* genel overlayler */}
      <MapOverlays
        available={available}
        coords={coords}
        onRetry={refreshLocation}
        onRecenter={(region) => {
          map.setRegion(region);
          mapRef.current?.animateToRegion(region, 500);
        }}
      />
    </View>
  );
}

/* -------------------------------- Styles -------------------------------- */
const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject, zIndex: 0 },

  routeControls: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 50,
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    elevation: 4,
  },
    reverseCornerButton: {
    position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#eee', justifyContent: 'center', alignItems: 'center', zIndex: 10, elevation: 3,
  },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 4, color: '#333' },
  inputButton: {
    height: 48, backgroundColor: '#f9f9f9', borderColor: '#ccc',
    borderWidth: 1, borderRadius: 8, justifyContent: 'center', paddingHorizontal: 12,
  },
  inputText: { fontSize: 16, color: '#333' },

  transparentOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)' },
  selectionPromptContainer: { position: 'absolute', top: '40%', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 20 },
  selectionPromptText: { backgroundColor: 'rgba(255,255,255,0.9)', padding: 12, borderRadius: 8, fontSize: 16, color: '#333', textAlign: 'center' },

  routeSheetHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  closeButton: { padding: 8 },
  closeButtonText: { fontSize: 18, fontWeight: 'bold', color: '#666' },

  addStopFab: {
    position: 'absolute', right: 16, bottom: 300,
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#1E88E5',
    alignItems: 'center', justifyContent: 'center', elevation: 8,
  },
  addStopFabText: { fontSize: 26, color: '#fff', fontWeight: '800', marginTop: -2 },

  editStopsBtn: {
    position: 'absolute', right: 16, bottom: 250,
    backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
    elevation: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
  },
  editStopsText: { fontWeight: '700', color: '#111' },

  wpDotOuter: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(255,193,7,0.18)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,193,7,0.5)',
  },
  wpDotInner: {
    minWidth: 18, height: 32, borderRadius: 9,
    backgroundColor: '#FFC107', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  wpNum: { fontSize: 11, fontWeight: '700', color: '#111' },

  candidateDotOuter: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(220,53,69,0.18)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(220,53,69,0.5)',
  },
  candidateDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#DC3545' },

  poiDotOuter: {
    backgroundColor: 'white', borderRadius: 12, paddingVertical: 3, paddingHorizontal: 6,
    elevation: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
  },
  poiEmoji: { fontSize: 16 },

  calloutCard: {
    minWidth: 240, maxWidth: 340,
    backgroundColor: '#fff', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    elevation: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd',
  },
  calloutTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  calloutSub: { marginTop: 4, fontSize: 12, color: '#555' },
  calloutCta: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: '#E6F4EA', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  calloutCtaText: { fontSize: 13, fontWeight: '700', color: '#111' },
});
