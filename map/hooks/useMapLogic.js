import { useState, useCallback, useRef,useEffect } from 'react';
import { Alert } from 'react-native';
import {
  getPlaceDetails,
  getNearbyPlaces,
  getAddressFromCoords,
  getRoute,
  decodePolyline,
} from '../maps';
import { GOOGLE_MAPS_API_KEY as KEY } from '@env';
import isEqual from 'lodash.isequal';


const ANKARA_CENTER = { latitude: 39.925533, longitude: 32.866287 };

export function useMapLogic(mapRef, selectedMode) {
  const [region, setRegion] = useState({
    ...ANKARA_CENTER,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  });
  const [routeCoords, setRouteCoords] = useState([]);

  const [marker, setMarker] = useState(null);
  const [categoryMarkers, setCategoryMarkers] = useState([]);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeDrawn, setRouteDrawn] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [mapMoved, setMapMoved] = useState(false);
  const [routeOptions, setRouteOptions] = useState({});

   // ➊ Harita her değiştiğinde region ve mapMoved güncellensin
  const onRegionChange = useCallback(
   (newRegion) => {
     _setRegion(newRegion);
     setMapMoved(true);
   },
   []
 );
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const [phase, setPhase] = useState('from');          // 'from' | 'to' | 'ready'
  const [fromLocation, setFromLocation] = useState(null);
  const [toLocation, setToLocation] = useState(null);
  

  const lastPlacesKey = useRef(null);
  

  const getRouteBetween = useCallback(async (startCoord, destCoord, mode = 'driving') => {
  try {
    const route = await getRoute(startCoord, destCoord, mode);
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
  setFromLocation({
    description: place.description,
    coordinate: place.coords ?? place.coordinate, // ikisini de destekle
    key: place.key || 'from',
  });
  setPhase('to');
}, []);

  const fetchAllRoutes = async (fromCoord, toCoord) => {
  const modes = ['driving', 'walking', 'transit']; // istersen 'transit' de ekle
  const results = await Promise.all(
  modes.map(async (m) => {
    const routes = await getRoute(fromCoord, toCoord, m); // artık liste dönüyor
    if (!routes) return [];

    return routes.map((route, index) => {
      const decodedCoords = decodePolyline(route.polyline);
      return {
        ...route,
        decodedCoords,
        isPrimary: index === 0,
        mode: m,
      };
    });
  })
);

const flattened = results.flat();
setRouteOptions(prev => ({
  ...prev,
  [mode]: updatedRoutesForThisMode,
}));


// En kısa süreli rotayı bul
const shortest = flattened.reduce((best, r) => {
  const dur = parseInt(r.duration.replace(/\D/g, ''), 10); // "13 mins" → 13
  const bestDur = parseInt(best.duration.replace(/\D/g, ''), 10);
  return dur < bestDur ? r : best;
}, flattened[0]);

const updatedRoutes = flattened.map(route => ({
  ...route,
  isPrimary: route.id === shortest.id, // sadece en kısa olan true
}));

setRouteOptions(updatedRoutes);

// Onu ana rota yap
setRouteCoords(shortest.decodedCoords);
setRouteInfo({
  distance: shortest.distance,
  duration: shortest.duration,
});
setRouteDrawn(true);


  const routeMap = {};
  results.forEach((r) => {
    routeMap[r.mode] = r;
  });

  setRouteOptions(routeMap);

  // Varsayılan moda göre ilk çizimi yap
  const selected = (routeOptions[selectedMode] || []).find(r => r.isPrimary);
  if (selected?.decodedCoords) {
    setRouteCoords(selected.decodedCoords);
    setRouteInfo({
      distance: selected.distance,
      duration: selected.duration,
    });
    setRouteDrawn(true);
  }
};

  const handleSelectTo = useCallback(async place => {
  const to = {
    description: place.description,
    coordinate: place.coords ?? place.coordinate,
    key: place.key || 'to',
  };

  setToLocation(to);
  setPhase('ready');

  if (fromLocation?.coordinate) {
    // 🔴 Şu an sadece tek mod için rota alıyorsun:
    // await getRouteBetween(fromLocation.coordinate, to.coordinate, selectedMode);

    // ✅ Yerine tüm modlar için rota al:
    await fetchAllRoutes(fromLocation.coordinate, to.coordinate);
  }
}, [fromLocation]);



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
    // Aynı kategoriye tekrar tıklandıysa → KAPAT (toggle)
    if (type === activeCategory) {
      setActiveCategory(null);
      setQuery('');
      setMarker(null);
      setCategoryMarkers([]);
      setRouteCoords(null);
      setRouteInfo(null);
      setRouteDrawn(false);
      setMapMoved(false);
      return;
    }

    // Yeni kategori seçildi → TEMİZLE + YENİLE
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

      const rawPlaces = await getNearbyPlaces(center, type);
      const places = rawPlaces
        .map((item) => {
          const lat =
            item.coords?.latitude ??
            item.coordinate?.latitude ??
            item.geometry?.location?.lat;
          const lng =
            item.coords?.longitude ??
            item.coordinate?.longitude ??
            item.geometry?.location?.lng;
          if (lat == null || lng == null) return null;
          return { ...item, coordinate: { latitude: lat, longitude: lng } };
        })
        .filter(Boolean);

      const key = JSON.stringify(
        places.map((p) => p.place_id || p.id || p.name)
      );

      if (key !== lastPlacesKey.current) {
        setCategoryMarkers(places);
        lastPlacesKey.current = key;

        if (mapRef.current && places.length > 0) {
          mapRef.current.fitToCoordinates(
            places.map((p) => p.coordinate),
            {
              edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
              animated: true,
            }
          );
        }
      }

      console.log('📍 Kategoriye göre bulunan yerler:', places);
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
    const newMarkers = await getNearbyPlaces(center, activeCategory);
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


  const handleSelectRoute = useCallback((routeId) => {
  const updated = routeOptions.map(r => ({
    ...r,
    isPrimary: r.id === routeId,
  }));
  setRouteOptions(updated);

  const newPrimary = updated.find(r => r.id === routeId);
  if (newPrimary) {
    setRouteCoords(newPrimary.decodedCoords);
    setRouteInfo({
      distance: newPrimary.distance,
      duration: newPrimary.duration,
    });
    setRouteDrawn(true);
  }
}, [routeOptions]);

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
  async (e, overlayStates = {}) => {
    const { showOverlay: isOverlayVisible, showFromOverlay: isFromOverlayVisible, closeOverlays } = overlayStates;
    const { placeId, name, coordinate } = e.nativeEvent;

    // 🔽 Eğer rota overlay'i açıksa, tıklamada kapat ve çık
    if (isOverlayVisible || isFromOverlayVisible) {
      console.log('🛑 POI tıklandı ama overlay açık, kapatılıyor...');
      closeOverlays?.(); // dışarıdan gelen fonksiyon varsa çağır
      return;
    }

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

  useEffect(() => {
  const selected = (routeOptions[selectedMode] || []).find(r => r.isPrimary);

  console.log('🎯 Yeni mod için rota güncelleniyor:', selectedMode, selected);

  if (selected?.decodedCoords) {
    setRouteCoords(selected.decodedCoords);
    setRouteInfo({
      distance: selected.distance,
      duration: selected.duration,
    });
  } else {
    console.warn('⚠️ Seçilen mod için rota yok:', selectedMode);
  }
}, [selectedMode, routeOptions]);



  useEffect(() => {
    if (fromLocation?.coordinate && toLocation?.coordinate) {
      fetchAllRoutes(fromLocation.coordinate, toLocation.coordinate);
    }
  }, [fromLocation, toLocation]);


  return {
    fetchAndSetMarker,
    setMarker, // ✅ bu satırı ekle
    routeCoords,
    region,
    setRegion,
    onRegionChange,
    setRouteCoords,
    marker,
    categoryMarkers,
    loadingCategory,
    routeInfo,
    routeDrawn,
    query,
    setQuery,
    activeCategory,
    mapMoved,
    setMapMoved,
    setFromLocation,
    setToLocation,
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
    routeOptions,
    handleSelectRoute,
  };
}
