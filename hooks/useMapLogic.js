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

  // --- Loading Place Details ---
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // 1) Draw route polyline
  const handleDrawRoute = useCallback(() => {
    if (!routeInfo?.polyline) return;
    const coords = decodePolyline(routeInfo.polyline);
    setRouteCoords(coords);
    setRouteDrawn(true);
  }, [routeInfo]);

  // 2) SearchBar selection → full details + route
  const handleSelectPlace = useCallback(
    async (placeId, description) => {
      // reset
      setActiveCategory(null);
      setCategoryMarkers([]);
      setMapMoved(false);
      setRouteCoords(null);
      setRouteInfo(null);
      setRouteDrawn(false);
      setQuery(description);

      setIsLoadingDetails(true);
      try {
        const details = await getPlaceDetails(placeId);
        if (!details) throw new Error();

        const photos = details.photos?.map(
          p => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${p.photo_reference}&key=${KEY}`
        );
        const reviews = details.reviews?.map(r => ({
          authorName: r.author_name,
          text: r.text,
        }));

        const full = {
          name: details.name,
          address: details.formatted_address,
          website: details.website,
          phone: details.formatted_phone_number,
          rating: details.rating,
          priceLevel: details.price_level,
          openNow: details.opening_hours?.open_now,
          photos,
          reviews,
          coordinate: {
            latitude: details.geometry.location.lat,
            longitude: details.geometry.location.lng,
          },
        };
        setMarker(full);

        // zoom
        setRegion(r => ({
          latitude: full.coordinate.latitude,
          longitude: full.coordinate.longitude,
          latitudeDelta: r.latitudeDelta,
          longitudeDelta: r.longitudeDelta,
        }));

        // route back to Ankara
        const route = await getRoute(ANKARA_CENTER, full.coordinate);
        setRouteInfo(route);
      } catch {
        Alert.alert('Hata', 'Seçilen yerin detayları alınamadı.');
      } finally {
        setIsLoadingDetails(false);
      }
    },
    []
  );

  // 3) Category tap
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

  // 4) “Search This Area”
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

  // 5) Click on map / POI (basic reverse geocode)
  const handleMapPress = useCallback(
    async e => {
      const { latitude, longitude } = e.nativeEvent.coordinate;
      const info = await getAddressFromCoords(latitude, longitude);
      if (!info) return Alert.alert('Hata', 'Konum alınamadı.');

      setActiveCategory(null);
      setCategoryMarkers([]);
      setRouteCoords(null);
      setRouteInfo(null);
      setRouteDrawn(false);
      setMapMoved(false);

      setMarker({
        name: info.name,
        address: info.address,
        coordinate: info.coordinate,
      });
      setQuery(info.name);

      setRegion(r => ({
        latitude,
        longitude,
        latitudeDelta: r.latitudeDelta,
        longitudeDelta: r.longitudeDelta,
      }));

      const route = await getRoute(ANKARA_CENTER, info.coordinate);
      setRouteInfo(route);
    },
    []
  );

  // 6) Category Marker tap → full details + route
  const handleMarkerSelect = useCallback(
    async markerItem => {
      setIsLoadingDetails(true);
      try {
        const placeId = markerItem.place_id || markerItem.id;
        const details = await getPlaceDetails(placeId);
        if (!details) throw new Error();

        const photos = details.photos?.map(
          p => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${p.photo_reference}&key=${KEY}`
        );
        const reviews = details.reviews?.map(r => ({
          authorName: r.author_name,
          text: r.text,
        }));

        const full = {
          name: details.name,
          address: details.formatted_address,
          website: details.website,
          phone: details.formatted_phone_number,
          rating: details.rating,
          priceLevel: details.price_level,
          openNow: details.opening_hours?.open_now,
          photos,
          reviews,
          coordinate: markerItem.coordinate,
        };
        setMarker(full);
        setQuery(full.name);

        // zoom
        setRegion(r => ({
          latitude: full.coordinate.latitude,
          longitude: full.coordinate.longitude,
          latitudeDelta: r.latitudeDelta,
          longitudeDelta: r.longitudeDelta,
        }));

        // route back
        try {
          const route = await getRoute(ANKARA_CENTER, full.coordinate);
          setRouteInfo(route);
        } catch {
          setRouteInfo(null);
        }
      } catch {
        // fallback to basic marker
        setMarker(markerItem);
        setQuery(markerItem.name);
      } finally {
        setIsLoadingDetails(false);
      }
    },
    []
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
    isLoadingDetails,

    // Handlers
    handleSelectPlace,
    handleCategorySelect,
    handleSearchThisArea,
    handleMapPress,
    handleDrawRoute,
    handleMarkerSelect,
  };
}
