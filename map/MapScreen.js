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
import { reverseGeocode, getPlaceDetails, autocomplete } from './maps';

import { useRouteSheetController } from './hooks/useRouteSheetController';
import { useHistoryMigration } from './hooks/useHistoryMigration';
import { useRouteCompute } from './hooks/useRouteCompute';
import { History, HISTORY_KEYS, pushLabelHistoryCompat as pushLabelHistory } from './utils/history';

import PlaceDetailSheetContainer from './containers/PlaceDetailSheetContainer';
import RouteInfoSheetContainer from './containers/RouteInfoSheetContainer';

import ExploreLayer from './layers/ExploreLayer';
import RouteLayer from './layers/RouteLayer';
import PoiAlongRouteLayer from './layers/PoiAlongRouteLayer';

import RouteFormPanel from './components/RouteFormPanel';
import RouteFabControls from './components/RouteFabControls';
import { useBackBehavior } from './hooks/useBackBehavior';

import { useRoutePrefetch } from './hooks/useRoutePrefetch';
import { usePoiAlongRoute } from './hooks/usePoiAlongRoute';

import { useFromToSelection } from './hooks/useFromToSelection';
import { useStopsEditor } from './hooks/useStopsEditor';
import { useRouteCancel } from './hooks/useRouteCancel';

const xlog = (...a) => console.log('%c[XRAY] ', 'color:#ff3b30', ...a);
const WIZARD_TAB   = 'Gezilerim';
const WIZARD_ROUTE = 'CreateTripWizard';
const useMountedRef = () => {
  const r = React.useRef(true);
  useEffect(() => () => { r.current = false; }, []);
  return r;
};

// Seçilen marker/POI'yi köprü formatına çevir
function markerToHub(m) {
  if (!m) return null;
  const lat =
    m?.coords?.latitude ?? m?.coordinate?.latitude ??
    m?.geometry?.location?.lat ?? m?.latitude ?? m?.location?.lat;
  const lng =
    m?.coords?.longitude ?? m?.coordinate?.longitude ??
    m?.geometry?.location?.lng ?? m?.longitude ?? m?.location?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const name = m?.name || m?.title || m?.description || 'Seçilen konum';
  const place_id = m?.place_id || m?.id || null;
  return { name, place_id, location: { lat, lng } };
}

export default function MapScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const picker = route.params?.picker?.enabled ? route.params.picker : null; // { enabled, which, center, cityName, sheetInitial, version }
  const mountedRef = useMountedRef();
  const mapRef = useRef(null);
  const map = useMapLogic(mapRef);
  const { coords, available, refreshLocation } = useLocation();
  const isPlaceSheetOpenRef = useRef(false);
  const autoCategoryAppliedRef = useRef(false);
  const sheetHalfSnappedRef = useRef(false);

  const hasCenteredOnceRef = useRef(false);
  const isFollowingRef = useRef(true);
  const prevAvailableRef = useRef(available);
  const lastCenteredVersionRef = useRef(null);
  const userMovedSincePickerRef = useRef(false);
  const lastUserRegionRef = useRef(null);
  const prePickerRegionRef = useRef(null);

  const sheetRef = useRef(null);          // PlaceDetailSheet
  const sheetRefRoute = useRef(null);     // RouteInfoSheet
  const [mapReady, setMapReady] = useState(false);

  const routeSheetAutoOpenRef = useRef(true);
  const {
    present: presentRouteSheet,
    dismiss: dismissRouteSheet,
    presentedRef: routeSheetPresentedRef,
    resumeAfterNavRef: resumeSheetAfterNavRef,
  } = useRouteSheetController(sheetRefRoute);

  // Aynı anda birden çok present/dismiss’i engelle
  const presentingRef = useRef(false);
  const safePresentRouteSheet = useCallback(() => {
    if (presentingRef.current || routeSheetPresentedRef.current) return;
    presentingRef.current = true;
    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        if (!mountedRef.current) { presentingRef.current = false; return; }
        if (!routeSheetPresentedRef.current) {
          try { presentRouteSheet(); } finally { presentingRef.current = false; }
        } else {
          presentingRef.current = false;
        }
      });
    });
  }, [presentRouteSheet]);
  const dismissingRef = useRef(false);
  const safeDismissRouteSheet = useCallback(() => {
    if (dismissingRef.current || !routeSheetPresentedRef.current) return;
    dismissingRef.current = true;
    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        if (!mountedRef.current) { dismissingRef.current = false; return; }
        try {
          dismissRouteSheet();
        } finally {
          dismissingRef.current = false;
        }
      });
    });
  }, [dismissRouteSheet]);

  const [mode, setMode] = useState('explore');
  const [canShowScan, setCanShowScan] = useState(false);
  const [mapMovedAfterDelay, setMapMovedAfterDelay] = useState(false);
  const [showFromOverlay, setShowFromOverlay] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayContext, setOverlayContext] = useState(null); // 'from' | 'to'
  const [isSelectingFromOnMap, setIsSelectingFromOnMap] = useState(false);
  const [showSelectionHint, setShowSelectionHint] = useState(false);

  const [routeCoords, setRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);

  const [isNavigating, setIsNavigating] = useState(false);
  const [firstManeuver, setFirstManeuver] = useState(null);

  useHistoryMigration();

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

  /* -------------------------- picker merkezine odakla -------------------------- */
  const focusToPickerCenter = useCallback(() => {
    const raw = picker?.center || null; // {lat,lng} | {latitude,longitude}
    const lat = Number(raw?.lat ?? raw?.latitude);
    const lng = Number(raw?.lng ?? raw?.longitude);
    if (!mapRef.current || !mapReady || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

    isFollowingRef.current = false;
    hasCenteredOnceRef.current = true;

    const region = { latitude: lat, longitude: lng, latitudeDelta: 0.08, longitudeDelta: 0.08 };
    try {
      if (mapRef.current.animateCamera) {
        mapRef.current.animateCamera(
          { center: { latitude: lat, longitude: lng }, zoom: 12 },
          { duration: 600 }
        );
      } else {
        mapRef.current.animateToRegion(region, 600);
      }
    } catch {
      map.setRegion(region);
    }
  }, [picker?.center, mapReady, map]);

  // Her picker.version için sadece 1 kere odakla
  const centerOnceForPicker = useCallback(() => {
    const v = picker?.version ?? 'no-version';
    if (!picker?.enabled) return;
    if (!mapReady) return;
    if (lastCenteredVersionRef.current === v) return;
    if (userMovedSincePickerRef.current) return;
    focusToPickerCenter();
    lastCenteredVersionRef.current = v;
  }, [picker?.enabled, picker?.version, mapReady, focusToPickerCenter]);

  /* -------------------------- Sheet açılış davranışları -------------------------- */
   useEffect(() => {
     if (!picker?.enabled) { sheetHalfSnappedRef.current = false; return; }
     if (sheetHalfSnappedRef.current) return;
     if (picker?.which === 'lodging' || picker?.sheetInitial === 'half') {
       try { sheetRef.current?.snapToIndex?.(1); } catch {}
     }
     sheetHalfSnappedRef.current = true;
   }, [picker?.enabled, picker?.which, picker?.sheetInitial]);

  // Picker açık — explore modda tut ve merkeze odakla
  useEffect(() => {
    if (picker?.enabled) {
      setMode('explore');
      userMovedSincePickerRef.current = false;
      if (!prePickerRegionRef.current && lastUserRegionRef.current) {
        prePickerRegionRef.current = lastUserRegionRef.current;
      }
    }
  }, [picker?.enabled]);

  // 👇 haritayı eski haline döndüren yardımcı
  const resetAfterPicker = useCallback(() => {
    try { navigation.setParams({ picker: undefined }); } catch {}
    try {
      map.setMarker(null);
      map.setQuery('');
    } catch {}
    try { sheetRef.current?.close?.(); } catch {}
    const region = prePickerRegionRef.current || lastUserRegionRef.current;
    if (region && mapRef.current) {
      requestAnimationFrame(() => {
        try { mapRef.current.animateToRegion(region, 500); }
        catch { map.setRegion(region); }
      });
    }
    userMovedSincePickerRef.current = false;
    prePickerRegionRef.current = null;
  }, [navigation, map]);

  // Picker açıldığında explore’a geç
  useEffect(() => {
    if (mapReady) centerOnceForPicker();
  }, [mapReady, centerOnceForPicker]);

  useFocusEffect(
    React.useCallback(() => {
      if (picker?.enabled) requestAnimationFrame(centerOnceForPicker);

      if (mode === 'route' && resumeSheetAfterNavRef.current) {
        const list = map.routeOptions?.[map.selectedMode] || [];
        const primary = (list.find(r => r.isPrimary) || list[0]);
        const hasRoute = !!(primary && primary.decodedCoords && primary.decodedCoords.length > 0);
        if (hasRoute) {
          InteractionManager.runAfterInteractions(() => { presentRouteSheet(); });
        }
        resumeSheetAfterNavRef.current = false;
      }
    }, [picker?.enabled, centerOnceForPicker, mode, map.selectedMode, map.routeOptions, presentRouteSheet])
  );

  // Picker center güncellenirse (örn. başka şehir seçimi) sadece hareket edilmediyse odakla
  useEffect(() => {
    if (!picker?.enabled) return;
    if (!userMovedSincePickerRef.current) centerOnceForPicker();
  }, [picker?.center, picker?.enabled, centerOnceForPicker]);

  const finishPickerSelection = useCallback((hub) => {
    if (!picker?.enabled) return;
    const payload = {
      which: picker?.which || 'lodging',
      cityKey: picker?.cityKey || null,
      hub: hub || null,   // null = temizle, undefined = iptal
    };

    try {
      navigation.navigate(WIZARD_TAB, {
        screen: WIZARD_ROUTE,
        params: { pickFromMap: payload },
        merge: true,
      });
    } catch {}
    // 2) Picker UI'ını sıfırla ve Map'ten çık
    try { resetAfterPicker(); } catch {}
    try { navigation.goBack(); } catch {}
  }, [picker?.enabled, picker?.which, picker?.cityKey, navigation, resetAfterPicker]);

  const { recalcRoute, prefetchMissingModes } = useRouteCompute({
    map, mapRef, normalizeCoord, presentRouteSheet,
  });

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
    routeSheetAutoOpenRef,
  });

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
    mapRef,
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

  useRoutePrefetch({ mode, map, normalizeCoord, prefetchMissingModes });

  useBackBehavior({
    mode,
    placeSheetOpenRef: isPlaceSheetOpenRef,
    placeSheetRef: sheetRef,
    routeSheetPresentedRef,
    dismissRouteSheet,
    handleCancelRoute,
  });

  /* -------------------------- SAFE WRAPPERS (fallback) -------------------------- */
  const handlePlaceSelectSafe = useCallback(async (placeId, description) => {
    if (typeof map.handleSelectPlace === 'function') {
      return map.handleSelectPlace(placeId, description);
    }
    try {
      const details = await getPlaceDetails(placeId);
      const loc = details?.geometry?.location;
      if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
        map.setMarker({
          name: details?.name || description || 'Seçilen konum',
          place_id: placeId,
          coordinate: { latitude: loc.lat, longitude: loc.lng },
          geometry: { location: loc },
        });
        requestAnimationFrame(() => sheetRef.current?.snapToIndex?.(0));
        mapRef.current?.animateCamera?.(
          { center: { latitude: loc.lat, longitude: loc.lng }, zoom: 15 },
          { duration: 500 }
        );
      }
    } catch (e) { console.warn('[fallback] getPlaceDetails error:', e?.message || e); }
  }, [map, mapRef]);

  const handleCategorySelectSafe = useCallback((key) => {
    if (typeof map.handleCategorySelect === 'function') return map.handleCategorySelect(key);
    // fallback: en azından query'yi set etsin
    return map.setQuery?.(key);
  }, [map]);

  const handlePoiClickSafe = useCallback((evt) => {
    if (typeof map.handlePoiClick === 'function') {
      return map.handlePoiClick(evt, {
        showOverlay,
        showFromOverlay,
        closeOverlays: () => { setShowOverlay(false); setShowFromOverlay(false); },
      });
    }
    const p = evt?.nativeEvent;
    const c = p?.coordinate;
    if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
      map.setMarker({
        name: p?.name || 'Seçilen konum',
        place_id: p?.placeId || null,
        coordinate: { latitude: c.latitude, longitude: c.longitude },
      });
      requestAnimationFrame(() => sheetRef.current?.snapToIndex?.(0));
    }
  }, [map, showOverlay, showFromOverlay]);

  /* -------------------------- UI davranışları -------------------------- */
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

  // explore sheet aç/kapa
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

  // Kullanıcı konumuna ilk merkezleme (picker açıkken yapma)
  useEffect(() => {
    if (picker?.enabled) return;
    if (prevAvailableRef.current === false && available === true) {
      hasCenteredOnceRef.current = false;
      isFollowingRef.current = true;
    }
    prevAvailableRef.current = available;

    if (!available || !coords || !mapRef.current) return;

    if (!hasCenteredOnceRef.current && isFollowingRef.current) {
      const region = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };
      requestAnimationFrame(() => {
        map.setRegion(region);
        try { mapRef.current.animateToRegion(region, 600); }
        catch { map.setRegion(region); }
      });
      hasCenteredOnceRef.current = true;
    }
  }, [available, coords, map, picker?.enabled]);

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
    lastUserRegionRef.current = region;
  };

  const handleUserGesture = useCallback(() => {
    if (isFollowingRef.current) isFollowingRef.current = false;
    if (showSelectionHint) setShowSelectionHint(false);
    // kullanıcı artık haritayı oynattı; picker kaynaklı otomatik odak devre dışı
    userMovedSincePickerRef.current = true;
  }, [showSelectionHint]);

  /* -------------------------- Route sheet auto-open -------------------------- */
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
      if (routeSheetAutoOpenRef.current && (allReady || routeSheetPresentedRef.current)) {
        safePresentRouteSheet();
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
    if (routeSheetAutoOpenRef.current && (allReady || routeSheetPresentedRef.current)) {
      const id = setTimeout(() => safePresentRouteSheet(), 0);
      return () => clearTimeout(id);
    }
  }, [mode, routeCoords, map.routeOptions, presentRouteSheet]);

  // dışarıdan gelen routeRequest
  useEffect(() => {
    const req = route?.params?.routeRequest;
    if (!req || !req.from || !req.to) return;

    const fromC = normalizeCoord(req.from);
    const toC   = normalizeCoord(req.to);
    if (!fromC || !toC) return;

    setMode('route');
    routeSheetAutoOpenRef.current = true;
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

  return (
    <View style={styles.container}>
      <MapView
        key={`cat-${map.categoryMarkers.length}`}
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={map.region}
        onPress={(e) => {
          handleUserGesture();
          if (picker?.enabled && picker?.which === 'lodging') {
            const c = e?.nativeEvent?.coordinate;
            if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
              map.setMarker({
                name: 'Seçilen konum',
                coordinate: { latitude: c.latitude, longitude: c.longitude },
                place_id: null,
              });
              requestAnimationFrame(() => sheetRef.current?.snapToIndex?.(0));
            }
            return; // route akışı ile çakışmasın
          }
          handleMapPress(e);
        }}
        onLongPress={(e) => {
          if (picker?.enabled && picker?.which === 'lodging') {
            const c = e?.nativeEvent?.coordinate;
            if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
              map.setMarker({
                name: 'Seçilen konum',
                coordinate: { latitude: c.latitude, longitude: c.longitude },
                place_id: null,
              });
              requestAnimationFrame(() => sheetRef.current?.snapToIndex?.(0));
            }
          }
        }}
        onPanDrag={handleUserGesture}
        onRegionChangeComplete={onRegionChangeComplete}
        scrollEnabled
        zoomEnabled
        rotateEnabled
        pitchEnabled
        onMapReady={() => {
          setMapReady(true);
          if (picker?.enabled) requestAnimationFrame(centerOnceForPicker);
        }}
        onPoiClick={(e) => {
          handleUserGesture();
          if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'from') {
            handleSelectOriginOnMap(e.nativeEvent.coordinate);
            return;
          }
          if (mode === 'route' && isSelectingFromOnMap && overlayContext === 'to') {
            handleSelectDestinationOnMap(e.nativeEvent.coordinate);
            return;
          }
          handlePoiClickSafe(e);
        }}
        // picker açıkken mavi noktayı göstermiyoruz (kafa karışmasın)
        showsUserLocation={available && !picker?.enabled}
      >
        <ExploreLayer active={mode === 'explore'} map={map} setMarkerRef={setMarkerRef} />
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

      {showSelectionHint && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={styles.transparentOverlay} pointerEvents="none" />
          <View style={styles.selectionPromptContainer} pointerEvents="none">
            <Text style={styles.selectionPromptText}>Haritaya dokunarak bir konum seçin</Text>
          </View>
        </View>
      )}

      <SafeAreaView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
         {/* Üst sabit geri butonu */}
         {mode === 'route' && (
           <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
             <TouchableOpacity
               onPress={handleCancelRoute}
               style={styles.backFab}
               activeOpacity={0.8}
               hitSlop={{ top: 10, left: 10, bottom: 10, right: 10 }}
             >
               <Text style={styles.backFabText}>← Geri Dön</Text>
             </TouchableOpacity>
           </View>
         )}
        {/* 👇 Picker modunda hızlı kaçış */}
        {picker?.enabled && (
          <TouchableOpacity
            onPress={() => {
              try { resetAfterPicker(); } catch {}
              try { navigation.goBack(); } catch {}
            }}
            style={styles.pickerExitBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.pickerExitText}>← Geri Dön</Text>
          </TouchableOpacity>
        )}

        {(mode === 'explore' || picker?.enabled) && (
          <>
            <MapHeaderControls
              query={map.query}
              onQueryChange={map.setQuery}
              onPlaceSelect={handlePlaceSelectSafe}
              onCategorySelect={handleCategorySelectSafe}
              mapMovedAfterDelay={mapMovedAfterDelay}
              loadingCategory={map.loadingCategory}
              onSearchArea={map.handleSearchThisArea || (() => {})}
              activeCategory={map.activeCategory}

              /* 👇 picker dostu ipuçları */
              isPickerMode={!!picker?.enabled}
              autoFocusSearch={!!picker?.enabled}
              allowCategory={true}
              allowSearch={true}
            />

            {map.activeCategory && map.categoryMarkers.length > 0 && (
              <CategoryList
                data={map.categoryMarkers}
                activePlaceId={map.marker?.place_id}
                userCoords={coords}
                onSelect={(placeId, description) => {
                  handlePlaceSelectSafe(placeId, description);
                  setTimeout(() => {
                    const ref = markerRefs.current.get(placeId);
                    ref?.showCallout?.();
                  }, 360);
                }}
              />
            )}
          </>
        )}

        {/* onGetDirections: önce PlaceDetailSheet’i kapat */}
        <PlaceDetailSheetContainer
          ref={sheetRef}
          map={map}
          picker={picker}
          navigation={navigation}
          onConfirmPicker={(hub) => {
            if (!picker?.enabled) return;
            if (hub) finishPickerSelection(hub);
          }}
          onGetDirections={() => {
            sheetRef.current?.close?.();
            onGetDirectionsPress();
          }}
          onOpen={() => { isPlaceSheetOpenRef.current = true; }}
          onClose={() => { isPlaceSheetOpenRef.current = false; }}
        />

        {/* “Başlangıç ekle” akışı */}
        {showFromOverlay && (
          <GetDirectionsOverlay
            visible={showFromOverlay}
            userCoords={coords}
            available={available}
            refreshLocation={refreshLocation}
            historyKey="search_history_from"
            favoritesKey="favorite_places_from"
            onCancel={() => setShowFromOverlay(false)}
            onFromSelected={(place) => {
              sheetRef.current?.close?.();
              handleFromSelected(place);
              setShowFromOverlay(false);
            }}
            onMapSelect={() => {
              sheetRef.current?.close?.();
              setShowFromOverlay(false);
              setMode('route');
              setOverlayContext('from');
              map.setFromLocation(null);
              setIsSelectingFromOnMap(true);
              setShowSelectionHint(true);
              centerOnceForPicker();
              if (map.marker) {
                map.setToLocation({ coords: map.marker.coordinate, description: map.marker.name });
              }
            }}
          />
        )}

        {mode === 'route' && (
          <RouteFormPanel
            styles={styles}
            fromLabel={map.fromLocation?.description}
            toLabel={map.toLocation?.description}
            onSwap={handleReverseRoute}
            onPickFrom={() => {
              sheetRef.current?.close?.();
              setOverlayContext('from');
              setShowOverlay(true);
            }}
            onPickTo={() => {
              sheetRef.current?.close?.();
              setOverlayContext('to');
              setShowOverlay(true);
            }}
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
                ? (place) => {
                    sheetRef.current?.close?.();
                    handleFromSelected(place);
                    setShowOverlay(false);
                  }
                : undefined
            }
            onToSelected={
              overlayContext === 'to'
                ? (place) => {
                    sheetRef.current?.close?.();
                    handleToSelected(place);
                    setShowOverlay(false);
                  }
                : undefined
            }
            onMapSelect={() => {
              sheetRef.current?.close?.();
              setShowOverlay(false);
              setMode('route');
              setIsSelectingFromOnMap(true);
              setShowSelectionHint(true);
              centerOnceForPicker();
            }}
          />
        )}

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
          onCancel={() => {
            routeSheetAutoOpenRef.current = false;
            handleCancelRoute();
          }}
          onModeChange={map.handleSelectRoute}
          onModeRequest={async (m)=> {
            sheetRef.current?.close?.();
            try { await (async () => {
              map.setSelectedMode(m);
              const has = Array.isArray(map.routeOptions?.[m]) && map.routeOptions[m].length > 0;
              if (has) return;
              const f = normalizeCoord(map.fromLocation?.coords);
              const t = normalizeCoord(map.toLocation?.coords);
              if (f && t) await recalcRoute(m, null, f, t);
            })(); } catch(e){ console.warn(e); }
          }}
          onStart={() => {
            resumeSheetAfterNavRef.current = true;
            safeDismissRouteSheet();

            const f = normalizeCoord(map.fromLocation?.coords);
            const t = normalizeCoord(map.toLocation?.coords);
            if (!f || !t) return;

            const wps = Array.isArray(map.waypoints)
              ? map.waypoints.map(w => ({
                  lat: w.lat ?? w.latitude,
                  lng: w.lng ?? w.longitude,
                  name: w.name ?? w.description ?? null,
                  address: w.address ?? null,
                  place_id: w.place_id ?? w.key ?? null,
                })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
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

      {isNavigating && firstManeuver && (
        <NavigationBanner
          maneuver={firstManeuver}
          duration={routeInfo?.duration}
          distance={routeInfo?.distance}
          onCancel={handleCancelRoute}
        />
      )}

      <MapOverlays
        available={available}
        coords={coords}
        onRetry={refreshLocation}
        onRecenter={(region) => {
          isFollowingRef.current = true;
          hasCenteredOnceRef.current = false;
          map.setRegion(region);
          mapRef.current?.animateToRegion(region, 500);
        }}
      />
    </View>
  );
}

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

   backFab: {
     position: 'absolute',
     top: Platform.OS === 'ios' ? 12 : 12,
     left: 12,
     backgroundColor: 'rgba(13,15,20,0.9)',
     borderRadius: 22,
     paddingVertical: 10,
     paddingHorizontal: 14,
     elevation: 8,
     zIndex: 9999,
     borderWidth: StyleSheet.hairlineWidth,
     borderColor: '#23262F',
   },
   backFabText: { color: '#fff', fontWeight: '700', fontSize: 15 },

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
  ctaBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  ctaBtnText: { color:'#fff', fontWeight:'700', fontSize:16 },
  cancelBtn: {
    backgroundColor: '#0D0F14',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#23262F',
  },
  cancelBtnText: { color:'#fff', fontWeight:'700' },

  /* 👇 yeni: picker hızlı çıkış butonu */
  pickerExitBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 20,
    left: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#333',
    zIndex: 9999,
  },
  pickerExitText: { color: '#fff', fontWeight: '700' },
});
