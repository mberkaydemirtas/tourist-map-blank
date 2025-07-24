import { useState, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import {
  getPlaceDetails,
  getNearbyPlaces,
  getAddressFromCoords,
  getRoute,
  decodePolyline,
} from '../services/maps';
import { GOOGLE_MAPS_API_KEY as KEY } from '@env';
import isEqual from 'lodash.isequal';

const ANKARA_CENTER = { latitude: 39.925533, longitude: 32.866287 };

export function useMapLogic(mapRef) {
  const [region, setRegion] = useState({
    ...ANKARA_CENTER,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
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

  const [phase, setPhase] = useState('from');          // 'from' | 'to' | 'ready'
  const [fromLocation, setFromLocation] = useState(null);
  const [toLocation, setToLocation] = useState(null);

  const lastPlacesKey = useRef(null);
          const getRouteBetween = useCallback(async (startCoord, destCoord) => {
          try {
            const route = await getRoute(startCoord, destCoord);
            setRouteInfo(route);
            const coords = decodePolyline(route.polyline);
            setRouteCoords(coords);
            setRouteDrawn(true);
          } catch (e) {
            console.warn('🛑 Rota alınamadı:', e);
            setRouteInfo(null);
            setRouteCoords(null);
            setRouteDrawn(false);
          }
        }, []);
  const handleSelectFrom = useCallback(place => {
    setFromLocation(place);
    setPhase('to');
  }, []);

  const handleSelectTo = useCallback(
    async place => {
      setToLocation(place);
      setPhase('ready');
       // fetch & draw route
      if (fromLocation?.coordinate) {
        await getRouteBetween(fromLocation.coordinate, place.coordinate);
      }
    },
    [fromLocation, getRouteBetween]
  );

    const fetchAndSetMarker = useCallback(
    async (placeId, fallbackCoord, fallbackName = '') => {
      setIsLoadingDetails(true);
      try {
        const details = await getPlaceDetails(placeId);
        if (!details) {
          console.warn('⚠️ Marker detayları boş geldi:', placeId);
          return null;
        }

        const coord = fallbackCoord || details.coords;
        const photos = details.photos || [];
        const reviews = details.reviews || [];
        const types = details.types || [];

        let resolvedName = details.name?.trim() && details.name.length > 3
          ? details.name
          : fallbackName || details.address || types[0]?.replace(/_/g, ' ') || 'Yer Bilgisi';

        setMarker({
          name: resolvedName,
          address: details.address,
          coordinate: coord,
          rating: details.rating ?? null,
          priceLevel: details.priceLevel ?? null,
          googleSearchUrl: details.googleSearchUrl,
          openNow: details.openNow,
          hoursToday: details.hoursToday,
          phone: details.phone,
          website: details.website,
          photos,
          reviews,
          types,
        });
        setQuery(resolvedName || details.address);

        return coord; // 🔑 kontrolu kolaylaştırmak için döndürüyoruz
      } catch (e) {
        Alert.alert('Hata', 'Yer detayları alınamadı.');
        console.warn('🛑 Marker detayları alınırken hata:', e);
        return null;
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

    // ——— handleSelectPlace: her zaman zoom yapacak ———
  const handleSelectPlace = useCallback(async (placeId, description) => {
    setMapMoved(false);
    setRouteCoords(null);
    setRouteInfo(null);
    setRouteDrawn(false);
    setQuery(description);
    const coord = await fetchAndSetMarker(placeId, null, description);
    if (coord && mapRef?.current?.animateToRegion) {
      const newRegion = {
        latitude: coord.latitude,
        longitude: coord.longitude,
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      };
      setRegion(newRegion);
      mapRef.current.animateToRegion(newRegion, 300);
    }
  }, [fetchAndSetMarker, mapRef]);


  const handleCategorySelect = useCallback(
  async (type) => {
    if (type === activeCategory) return;

    setActiveCategory(type);
    setQuery('');
    setMarker(null);
    setRouteCoords(null);
    setRouteInfo(null);
    setRouteDrawn(false);
    setMapMoved(false);
    setLoadingCategory(true);

    try {
      let center = region;

      if (mapRef?.current?.getCamera) {
        const camera = await mapRef.current.getCamera();
        center = {
          latitude: camera.center.latitude,
          longitude: camera.center.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        setRegion(center);
      }

      const placesRaw = await getNearbyPlaces(center, type);
      const formattedPlaces = placesRaw.map(p => ({
        ...p,
        coordinate: p.coords,        // ← Burada coords’u coordinate’a kopyaladık
      }));
      const key = JSON.stringify(formattedPlaces.map(p => p.place_id || p.id || p.name));

      if (key !== lastPlacesKey.current) {
        setCategoryMarkers(formattedPlaces);
        lastPlacesKey.current = key;

        // 🔍 Tüm yeni marker’ları gösterecek şekilde uzaklaş
        if (mapRef.current && formattedPlaces.length > 0) {
          mapRef.current.fitToCoordinates(
            formattedPlaces.map(p => p.coordinate),
            {
              edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
              animated: true,
            }
          );
        }
      }

      console.log('📍 Kategoriye göre bulunan yerler:', formattedPlaces);
    } catch (err) {
      console.error('Kategori arama hatası:', err);
    } finally {
      setLoadingCategory(false);
    }
  },
  [activeCategory, mapRef, region]
);


  const handleSearchThisArea = useCallback(async () => {
  if (!activeCategory) return;

  setLoadingCategory(true);
  try {
    // 1) True center’ı al
    let center = region;
    if (mapRef?.current?.getCamera) {
      const cam = await mapRef.current.getCamera();
      center = {
        latitude: cam.center.latitude,
        longitude: cam.center.longitude,
        latitudeDelta: region.latitudeDelta,
        longitudeDelta: region.longitudeDelta,
      };
      setRegion(center);
    }

    // 2) Yeni marker’ları çek
    const raw = await getNearbyPlaces(center, activeCategory);
    // coords ⇒ coordinate dönüştürmesi
    const newMarkers = raw.map(m => ({
        ...m,
        coordinate: m.coords,
        }));
    console.log('🔁 Bölge Tara Sonuçları:', newMarkers);

    // 3) State güncelle ve zoom-out
    if (
      categoryMarkers.length === newMarkers.length &&
      categoryMarkers.every((m, i) => m.place_id === newMarkers[i].place_id)
    ) {
      console.log('[DEBUG] Skipping marker update — same data');
    } else {
      setCategoryMarkers(newMarkers);
      if (mapRef.current && newMarkers.length > 0) {
  mapRef.current.fitToCoordinates(
    newMarkers.map(m => m.coordinate),
    {
      edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
      animated: true,
    }
  );
}


      // 📐 Tüm marker’ları kapsayacak şekilde uzaklaş
      if (mapRef.current && newMarkers.length > 0) {
        mapRef.current.fitToCoordinates(
          newMarkers.map(m => m.coordinate),
          { edgePadding: { top: 50, right: 50, bottom: 200, left: 50 }, animated: true }
        );
      }
    }
  } catch (err) {
    console.warn('🔴 Bölge tara hatası:', err);
  } finally {
    setMapMoved(false);
    setLoadingCategory(false);
  }
}, [activeCategory, categoryMarkers, region, mapRef]);



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
    async (placeId, coordinate, fallbackName = '') => {
      setRouteCoords(null);
      setRouteInfo(null);
      setRouteDrawn(false);
      setMapMoved(false);


      await fetchAndSetMarker(placeId, coordinate, fallbackName);

      if (coordinate && mapRef?.current?.getMapBoundaries) {
        const bounds = await mapRef.current.getMapBoundaries();
        const { latitude, longitude } = coordinate;

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
      } else if (coordinate && mapRef?.current?.animateToRegion) {
        // Harita sınırlarını alamıyorsak yine de zoom yap
        const newRegion = {
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        };
        setRegion(newRegion);
        mapRef.current.animateToRegion(newRegion, 300);
      }
        try {
          const route = await getRoute(ANKARA_CENTER, coord);
          setRouteInfo(route);
        } catch {
          setRouteInfo(null);
        }
      },
      [fetchAndSetMarker]
    );

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
      setQuery(name);

      await fetchAndSetMarker(placeId, coordinate, name);

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
    getRouteBetween,
    phase,
    fromLocation,
    toLocation,
    handleSelectFrom,
    handleSelectTo,
    handleSelectPlace,
    handleCategorySelect,
    handleSearchThisArea,
    handleMapPress,
    handleMarkerSelect,
    handleDrawRoute,
    handlePoiClick,
  };
}
