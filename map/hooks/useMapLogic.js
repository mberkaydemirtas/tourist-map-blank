import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useRouteLogic } from './useRouteLogic';
import { usePlacesLogic } from './usePlacesLogic';
import { useCategoryLogic } from './useCategoryLogic';
import { getAddressFromCoords } from '../../trips/services/placeService';
import { decodePolyline } from '../../trips/services/routeService';
import { normalizeCoord } from '../utils/coords';

const ANKARA_CENTER = { latitude: 39.925533, longitude: 32.866287 };

export function useMapLogic(mapRef) {
  // Bölge state'i orkestratörde
  const [region, setRegion] = useState({
    ...ANKARA_CENTER,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  });

  // Hook’ları içeri al
  const route = useRouteLogic(mapRef);
  const places = usePlacesLogic();
  const category = useCategoryLogic();

  /* ----------------------------- Bölge & Harita ----------------------------- */
  const onRegionChange = useCallback((newRegion) => {
    setRegion(newRegion);
    category.setMapMoved(true);
  }, [category]);

  /* ------------------------------- Yardımcılar ------------------------------ */
  const clearRouteState = useCallback(() => {
    route.setRouteDrawn(false);
    route.setRouteInfo(null);
    route.setRouteCoords([]);
  }, [route]);

  const clearCategoryState = useCallback(() => {
    category.setActiveCategory(null);
    category.setCategoryMarkers([]);
    category.setMapMoved(false);
  }, [category]);

  const clearPlaceQueryAndMarker = useCallback(() => {
    places.setQuery('');
    places.setMarker(null);
  }, [places]);

  /* ----------------------------- Route Sarmalayıcı -------------------------- */
  const fetchAllRoutes = useCallback(async (fromCoord, toCoord) => {
    // orijinal davranış: rota alırken kategori state’ini temizle
    clearCategoryState();
    await route.fetchAllRoutes(fromCoord, toCoord);
  }, [route, clearCategoryState]);

  const handleSelectTo = useCallback(async (place) => {
    clearCategoryState();
    await route.handleSelectTo(place); // kendi içinde fetchAllRoutes + driving seçimi yapıyor
  }, [route, clearCategoryState]);

  /* ---------------------------- Place Eventleri ----------------------------- */
  const handleSelectPlace = useCallback(async (placeId, description) => {
    try {
      // UI/state reset
      category.setMapMoved(false);
      clearRouteState();
      places.setQuery(description);

      // Marker + koordinatları çek
      const rawCoord = await places.fetchAndSetMarker(placeId, null, description);
      const coord = normalizeCoord(rawCoord);
      if (!coord) {
        console.warn('⚠️ handleSelectPlace: koordinat alınamadı');
        return;
      }

      // Haritayı odakla
      if (mapRef?.current?.animateToRegion) {
        const newRegion = {
          latitude: coord.latitude,
          longitude: coord.longitude,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        };
        setRegion(newRegion);
        mapRef.current.animateToRegion(newRegion, 300);
      }

      // fromLocation varsa seçilen yere rota oluştur
      const fromCoord = normalizeCoord(route.fromLocation?.coords);
      if (fromCoord) {
        await route.fetchAllRoutes(fromCoord, coord);
      }
    } catch (err) {
      console.warn('handleSelectPlace hata:', err);
    }
  }, [category, clearRouteState, places, mapRef, route]);

  const handleMapPress = useCallback(
    async e => {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      const info = await getAddressFromCoords(latitude, longitude);
      if (!info || !info.place_id) {
        Alert.alert('Hata', 'Bu konum için detay alınamadı.');
        return;
      }

      clearCategoryState();
      clearRouteState();
      category.setMapMoved(false);
      places.setQuery(info.address);

      await places.fetchAndSetMarker(info.place_id, { latitude, longitude }, info.address);

      setRegion(r => ({
        latitude,
        longitude,
        latitudeDelta: r.latitudeDelta,
        longitudeDelta: r.longitudeDelta,
      }));

      try {
        // yalnızca bilgi gösterimi (ankara merkez → seçilen nokta)
        await route.getRouteBetween(ANKARA_CENTER, { latitude, longitude }, route.selectedMode || 'driving');
      } catch {
        route.setRouteInfo(null);
      }
    },
    [places, route, category, clearCategoryState, clearRouteState]
  );

  const handleMarkerSelect = useCallback(
    async (placeId, coordinate, fallbackName = '') => {
      clearRouteState();
      category.setMapMoved(false);

      const coord = normalizeCoord(coordinate);
      await places.fetchAndSetMarker(placeId, coord, fallbackName);

      if (coord && mapRef?.current?.getMapBoundaries) {
        const bounds = await mapRef.current.getMapBoundaries();
        const { latitude, longitude } = coord;

        const padding = 0.005;
        const isVisible =
          latitude < bounds.northEast.latitude - padding &&
          latitude > bounds.southWest.latitude + padding &&
          longitude < bounds.northEast.longitude - padding &&
          longitude > bounds.southWest.longitude + padding;

        if (!isVisible) {
          const newRegion = {
            latitude,
            longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          };
          setRegion(newRegion);
          mapRef.current.animateToRegion(newRegion, 300);
        }
      } else if (coord && mapRef?.current?.animateToRegion) {
        const newRegion = {
          latitude: coord.latitude,
          longitude: coord.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        };
        setRegion(newRegion);
        mapRef.current.animateToRegion(newRegion, 300);
      }

      try {
        if (coord) {
          await route.getRouteBetween(ANKARA_CENTER, coord, route.selectedMode || 'driving');
        } else {
          route.setRouteInfo(null);
        }
      } catch {
        route.setRouteInfo(null);
      }
    },
    [places, route, category, clearRouteState, mapRef]
  );

  const handlePoiClick = useCallback(
    async (e, overlayStates = {}) => {
      const { showOverlay: isOverlayVisible, showFromOverlay: isFromOverlayVisible, closeOverlays } = overlayStates;
      const { placeId, name, coordinate } = e.nativeEvent;

      if (isOverlayVisible || isFromOverlayVisible) {
        console.log('🛑 POI tıklandı ama overlay açık, kapatılıyor...');
        closeOverlays?.();
        return;
      }

      if (!placeId || !coordinate) {
        Alert.alert('Hata', 'Seçilen POI bilgisi alınamadı.');
        return;
      }

      clearCategoryState();
      clearRouteState();
      category.setMapMoved(false);
      places.setQuery(name);

      await places.fetchAndSetMarker(placeId, coordinate, name);

      const newRegion = {
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setRegion(newRegion);
      requestAnimationFrame(() => {
        mapRef?.current?.animateToRegion(newRegion, 350);
      });

      try {
        await route.getRouteBetween(ANKARA_CENTER, coordinate, route.selectedMode || 'driving');
      } catch {
        route.setRouteInfo(null);
      }
    },
    [places, route, category, clearCategoryState, clearRouteState, mapRef]
  );

  /* --------------------------- Kategori Eventleri --------------------------- */
  const handleCategorySelect = useCallback(async (type) => {
    if (type === category.activeCategory) {
      // toggle off
      category.setActiveCategory(null);
      clearPlaceQueryAndMarker();
      category.setCategoryMarkers([]);
      clearRouteState();
      category.setMapMoved(false);
      return;
    }

    category.setActiveCategory(type);
    clearPlaceQueryAndMarker();
    clearRouteState();
    category.setMapMoved(false);

    await category.loadCategory(type, { mapRef, region, setRegion });
  }, [
    category,
    clearPlaceQueryAndMarker,
    clearRouteState,
    mapRef,
    region
  ]);

  const handleSearchThisArea = useCallback(async () => {
    await category.searchThisArea({
      activeCategory: category.activeCategory,
      mapRef, region, setRegion
    });
  }, [category, mapRef, region]);

  /* ------------------------------ Diğerleri -------------------------------- */
  const handleDrawRoute = route.handleDrawRoute; // mevcut davranış
  const getRouteBetween = route.getRouteBetween;
  const handleSelectFrom  = route.handleSelectFrom;
  const handleSelectRoute = route.handleSelectRoute;

  // 🧷 setQuery referansını sabitle (gereksiz rerender/resetleri önler)
  const setQuery = useCallback((q) => {
    places.setQuery(q);
  }, [places]);

  return {
    // places
    fetchAndSetMarker: places.fetchAndSetMarker,
    setMarker: places.setMarker,

    // route data
    routeCoords: route.routeCoords,
    region, setRegion,
    onRegionChange,
    setRouteCoords: route.setRouteCoords,

    waypoints: route.waypoints,
    setWaypoints: route.setWaypoints,
    calculateRouteWithStops: route.calculateRouteWithStops,

    marker: places.marker,
    categoryMarkers: category.categoryMarkers,
    loadingCategory: category.loadingCategory,

    routeInfo: route.routeInfo,
    setRouteInfo: route.setRouteInfo,
    routeDrawn: route.routeDrawn,

    query: places.query,
    setQuery, // 👈 sabit referans

    activeCategory: category.activeCategory,
    mapMoved: category.mapMoved,
    setMapMoved: category.setMapMoved,

    setFromLocation: route.setFromLocation,
    setToLocation: route.setToLocation,

    isLoadingDetails: places.isLoadingDetails,
    getRouteBetween,

    phase: route.phase,
    fromLocation: route.fromLocation,
    toLocation: route.toLocation,

    handleSelectFrom,
    handleSelectTo,
    handleSelectPlace,
    handleCategorySelect,
    handleSearchThisArea,
    handleMapPress,
    handleMarkerSelect,
    handleDrawRoute,
    handlePoiClick,

    routeOptions: route.routeOptions,
    setRouteOptions: route.setRouteOptions,
    handleSelectRoute,
    selectedMode: route.selectedMode,
    setSelectedMode: route.setSelectedMode,

    fetchAllRoutes,
  };
}
