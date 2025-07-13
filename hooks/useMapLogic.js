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
  const [region, setRegion] = useState({
    ...ANKARA_CENTER,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  });
  const [marker, setMarker] = useState(null);
  const [categoryMarkers, setCategoryMarkers] = useState([]);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeCoords, setRouteCoords] = useState(null);
  const [routeDrawn, setRouteDrawn] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [mapMoved, setMapMoved] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const fetchAndSetMarker = useCallback(
    async (placeId, fallbackCoord, fallbackName = '') => {
      setIsLoadingDetails(true);
      try {
        const details = await getPlaceDetails(placeId);
        if (!details) {
          console.warn('⚠️ Marker detayları boş geldi:', placeId);
          return;
        }

        const photos = Array.isArray(details.photos) ? details.photos : [];
        const reviews = details.reviews?.map(r => ({
          authorName: r.author_name,
          text: r.text,
        }));
        const types = details.types || [];

        const coord = fallbackCoord || details.coord;

        let resolvedName = details.name || fallbackName || '';
        if (
          resolvedName?.length <= 3 ||
          resolvedName?.match(/^[A-Z][a-z]+ [A-Z][a-z]+$/) ||
          resolvedName?.toLowerCase().includes('bakan') ||
          resolvedName?.toLowerCase().includes('doç') ||
          resolvedName?.toLowerCase().includes('dr') ||
          resolvedName?.toLowerCase().includes('gökhan')
        ) {
          resolvedName = fallbackName || types[0]?.replace(/_/g, ' ') || 'Yer Bilgisi';
        }

        setMarker({
          name: resolvedName,
          address: details.address,
          coordinate: coord,
          rating: details.rating ?? null,
          priceLevel: details.priceLevel ?? null,
          googleSearchUrl: `https://www.google.com/search?q=${encodeURIComponent(resolvedName)}`,
          openNow: details.openNow ?? null,
          hoursToday: details.hoursToday,
          phone: details.phone || null,
          website: details.website || null,
          photos,
          reviews,
          types,
        });

        setQuery(resolvedName || details.address);
      } catch (e) {
        Alert.alert('Hata', 'Yer detayları alınamadı.');
        console.warn('🛑 Marker detayları alınırken hata:', e);
      } finally {
        setIsLoadingDetails(false);
      }
    },
    []
  );

  const handleDrawRoute = useCallback(() => {
    if (!routeInfo?.polyline) return;
    const coords = decodePolyline(routeInfo.polyline);
    setRouteCoords(coords);
    setRouteDrawn(true);
  }, [routeInfo]);

  const handleSelectPlace = useCallback(
    async (placeId, description) => {
      setActiveCategory(null);
      setCategoryMarkers([]);
      setMapMoved(false);
      setRouteCoords(null);
      setRouteInfo(null);
      setRouteDrawn(false);
      setQuery(description);

      await fetchAndSetMarker(placeId, null, description);

      const newMarker = marker?.coordinate ? marker.coordinate : null;
      if (newMarker) {
        setRegion(r => ({
          latitude: newMarker.latitude,
          longitude: newMarker.longitude,
          latitudeDelta: r.latitudeDelta,
          longitudeDelta: r.longitudeDelta,
        }));

        try {
          const route = await getRoute(ANKARA_CENTER, newMarker);
          setRouteInfo(route);
        } catch {
          setRouteInfo(null);
        }
      }
    },
    [fetchAndSetMarker, marker]
  );

  const handleCategorySelect = useCallback(
    async type => {
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

  const handlePoiClick = useCallback(
    async e => {
      const { placeId, name, coordinate } = e.nativeEvent;
      if (!placeId || !coordinate) {
        Alert.alert('Hata', 'Seçilen POI bilgisi alınamadı.');
        return;
      }

      setActiveCategory(null);
      setCategoryMarkers([]);
      setRouteCoords(null);
      setRouteInfo(null);
      setRouteDrawn(false);
      setMapMoved(false);

      await fetchAndSetMarker(placeId, coordinate, name);
      setQuery(name);

      setRegion(r => ({
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        latitudeDelta: r.latitudeDelta,
        longitudeDelta: r.longitudeDelta,
      }));

      try {
        const route = await getRoute(ANKARA_CENTER, coordinate);
        setRouteInfo(route);
      } catch {
        setRouteInfo(null);
      }
    },
    [fetchAndSetMarker]
  );

  const handleMapPress = useCallback(
    async e => {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      const info = await getAddressFromCoords(latitude, longitude);
      if (!info || !info.place_id) {
        Alert.alert('Hata', 'Bu konum için detay alınamadı.');
        return;
      }

      setActiveCategory(null);
      setCategoryMarkers([]);
      setRouteCoords(null);
      setRouteInfo(null);
      setRouteDrawn(false);
      setMapMoved(false);
      setQuery(info.address);

      await fetchAndSetMarker(info.place_id, { latitude, longitude }, info.address);

      setRegion(r => ({
        latitude,
        longitude,
        latitudeDelta: r.latitudeDelta,
        longitudeDelta: r.longitudeDelta,
      }));

      try {
        const route = await getRoute(ANKARA_CENTER, { latitude, longitude });
        setRouteInfo(route);
      } catch {
        setRouteInfo(null);
      }
    },
    [fetchAndSetMarker]
  );

  const handleMarkerSelect = useCallback(
    async (placeId, coordinate) => {
      setRouteCoords(null);
      setRouteInfo(null);
      setRouteDrawn(false);
      setMapMoved(false);

      await fetchAndSetMarker(placeId, coordinate);

      if (coordinate) {
        setRegion(r => ({
          latitude: coordinate.latitude - 0.002,
          longitude: coordinate.longitude,
          latitudeDelta: r.latitudeDelta,
          longitudeDelta: r.longitudeDelta,
        }));

        try {
          const route = await getRoute(ANKARA_CENTER, coordinate);
          setRouteInfo(route);
        } catch {
          setRouteInfo(null);
        }
      }
    },
    [fetchAndSetMarker]
  );

  return {
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
    isLoadingDetails,

    handleSelectPlace,
    handleCategorySelect,
    handleSearchThisArea,
    handleMapPress,
    handleMarkerSelect,
    handleDrawRoute,
    handlePoiClick,
  };
}
