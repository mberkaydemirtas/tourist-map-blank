// src/hooks/useMapLogic.js

import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import {
  getPlaceDetails,
  getNearbyPlaces,
  getAddressFromCoords,
  getRoute,
  decodePolyline,
} from '../services/maps';
import { GOOGLE_MAPS_API_KEY as KEY } from '@env';

const ANKARA_CENTER = { latitude: 39.925533, longitude: 32.866287 };

export function useMapLogic() {
  // --- Region & Marker State ---
  const [region, setRegion] = useState({
    ...ANKARA_CENTER,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [marker, setMarker] = useState(null);

  // --- Category Search State ---
  const [categoryMarkers, setCategoryMarkers] = useState([]);
  const [loadingCategory, setLoadingCategory] = useState(false);

  // --- Route State ---
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeCoords, setRouteCoords] = useState(null);
  const [routeDrawn, setRouteDrawn] = useState(false);

  // --- UI Control State ---
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [mapMoved, setMapMoved] = useState(false);

  // 1) Rota çizme
  const handleDrawRoute = useCallback(() => {
    if (!routeInfo?.polyline) return;
    const coords = decodePolyline(routeInfo.polyline);
    setRouteCoords(coords);
    setRouteDrawn(true);
  }, [routeInfo]);

  // 2) SearchBar seçimi
  const handleSelectPlace = useCallback(
    async (placeId, description) => {
      setActiveCategory(null);
      setCategoryMarkers([]);
      setMapMoved(false);
      setRouteCoords(null);
      setRouteInfo(null);
      setRouteDrawn(false);
      setQuery(description);

      try {
        const details = await getPlaceDetails(placeId);
        if (!details) throw new Error();
        const coord = details.coord;

        setMarker({
          name: details.name,
          address: details.address,
          website: details.website,
          image: details.photos?.length
            ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${details.photos[0].photo_reference}&key=${KEY}`
            : null,
          coordinate: coord,
        });

        const newRegion = {
          ...coord,
          latitudeDelta: region.latitudeDelta,
          longitudeDelta: region.longitudeDelta,
        };
        setRegion(newRegion);

        const route = await getRoute(ANKARA_CENTER, coord);
        setRouteInfo(route);
      } catch {
        Alert.alert('Hata', 'Seçilen yerin detayları alınamadı.');
      }
    },
    [region]
  );

  // 3) Kategori seçimi
  const handleCategorySelect = useCallback(
    async (type) => {
      setActiveCategory(type);
      setQuery('');
      setMarker(null);
      setRouteCoords(null);
      setRouteInfo(null);
      setRouteDrawn(false);
      setMapMoved(false);
      setLoadingCategory(true);

      try {
        const results = await getNearbyPlaces(region, type);
        setCategoryMarkers(results);
      } catch {
        Alert.alert('Hata', 'Kategori araması başarısız oldu.');
      } finally {
        setLoadingCategory(false);
      }
    },
    [region]
  );

  // 4) “Bu bölgeyi tara”
  const handleSearchThisArea = useCallback(async () => {
    if (!activeCategory) return;
    setLoadingCategory(true);
    try {
      const results = await getNearbyPlaces(region, activeCategory);
      setCategoryMarkers(results);
      setMapMoved(false);
    } catch {
      Alert.alert('Hata', 'Bölge araması başarısız oldu.');
    } finally {
      setLoadingCategory(false);
    }
  }, [region, activeCategory]);

  // 5) Harita tıklama veya POI seçimi
  const handleMapPress = useCallback(
    async (e) => {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      const info = await getAddressFromCoords(latitude, longitude);
      if (!info) return Alert.alert('Hata', 'Konum alınamadı.');

      setActiveCategory(null);
      setCategoryMarkers([]);
      setRouteCoords(null);
      setRouteInfo(null);
      setRouteDrawn(false);
      setMapMoved(false);

      setMarker(info);
      setQuery(info.name);

      const newRegion = {
        latitude,
        longitude,
        latitudeDelta: region.latitudeDelta,
        longitudeDelta: region.longitudeDelta,
      };
      setRegion(newRegion);

      const route = await getRoute(ANKARA_CENTER, info.coordinate);
      setRouteInfo(route);
    },
    [region]
  );

  return {
    // State
    region,
    setRegion,
    marker,
    categoryMarkers,
    loadingCategory,
    routeInfo,
    routeCoords,
    routeDrawn,
    query,
    setQuery,
    activeCategory,
    mapMoved,
    setMapMoved,

    // Handlers
    handleSelectPlace,
    handleCategorySelect,
    handleSearchThisArea,
    handleMapPress,
    handleDrawRoute,
  };
}
