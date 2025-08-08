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
import { normalizeCoord, toCoordsObject } from '../utils/coords';


const ANKARA_CENTER = { latitude: 39.925533, longitude: 32.866287 };

export function useMapLogic(mapRef) {
  const [region, setRegion] = useState({
    ...ANKARA_CENTER,
    latitudeDelta: 0.03,
    longitudeDelta: 0.03,
  });
  const [routeCoords, setRouteCoords] = useState([]);
  const [selectedMode, setSelectedMode] = useState('driving');
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
     setRegion(newRegion);
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
    setRouteCoords([]);
    setRouteDrawn(false);
  }
}, []);

  const handleSelectFrom = useCallback(place => {
  setFromLocation({
    description: place.description,
    coords: place.coords ?? place.coordinate, // ikisini de destekle
    key: place.key || 'from',
  });
  setPhase('to');
}, []);

  const fetchAllRoutes = async (fromCoord, toCoord) => {
  const modes = ['driving', 'walking', 'transit'];
  const routeMap = {};
  setActiveCategory(null);
  setCategoryMarkers([]);

  // 1) Her mod için rota al ve decode et
  for (const mode of modes) {
    const routes = await getRoute(fromCoord, toCoord, mode);
    if (!routes || routes.length === 0) continue;

    routeMap[mode] = routes.map((route, index) => ({
      ...route,
      decodedCoords: decodePolyline(route.polyline),
      id: `${mode}-${index}`,
      isPrimary: false,  // önce tümünü false yap
      mode,
    }));
  }

  // 2) Eğer hiçbir rota yoksa çık
  const anyRoutes = Object.values(routeMap).flat();
  if (anyRoutes.length === 0) return;

  // 3) Her modun kendi fastest’ını işaretle
  Object.entries(routeMap).forEach(([mode, list]) => {
    if (list.length === 0) return;
    const fastestMode = list.reduce((a, b) =>
      a.durationValue < b.durationValue ? a : b
    );
    routeMap[mode] = list.map(r => ({
      ...r,
      isPrimary: r.id === fastestMode.id,
    }));
  });

  // 4) Global en hızlı rotayı seç ve onu çizdir / bilgileri göster
  const allRoutes = Object.values(routeMap).flat();
  const fastestGlobal = allRoutes.reduce((a, b) =>
    a.durationValue < b.durationValue ? a : b
  );

  // State güncellemeleri
  setRouteOptions(routeMap);
  setSelectedMode(fastestGlobal.mode);
  setRouteCoords(fastestGlobal.decodedCoords);
  setRouteInfo({
    distance: fastestGlobal.distance,
    duration: fastestGlobal.duration,
  });
  setRouteDrawn(true);
};

  const handleSelectTo = useCallback(async place => {
  const to = {
    description: place.description,
    coords: normalizeCoord(place.coords ?? place.coordinate ?? place),
    key: place.key || 'to',
  };

  setToLocation(to);
  setPhase('ready');

  // 🔥 Kategorileri temizle
  setActiveCategory(null);
  setCategoryMarkers([]);

  if (fromLocation?.coords && to?.coords) {
    await fetchAllRoutes(fromLocation.coords, to.coords);
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

        const coord = normalizeCoord(fallbackCoord || details.coords || details.geometry?.location);
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
  try {
    // UI/state reset
    setMapMoved(false);
    setRouteCoords([]);
    setRouteInfo(null);
    setRouteDrawn(false);
    setQuery(description);

    // Marker + koordinatları çek
    const rawCoord = await fetchAndSetMarker(placeId, null, description);
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

    // 🧭 fromLocation varsa seçilen yere rota oluştur
    const fromCoord = normalizeCoord(fromLocation?.coords);
    if (fromCoord) {
      const routes = await getRoute(fromCoord, coord);

      if (routes?.length) {
        // Varsayılan (ilk) rotayı çiz
        const primary = routes[0];
        const decoded = decodePolyline(primary.polyline || '');

        setRouteCoords(decoded);
        setRouteInfo({
          distance: primary.distance,
          duration: primary.duration,
        });
        setRouteDrawn(true);

        // ❗ mod bazlı sakla
        setRouteOptions(prev => ({
          ...prev,
          [selectedMode]: routes.map((r, i) => ({
            ...r,
            decodedCoords: decodePolyline(r.polyline || ''),
            isPrimary: i === 0,
            id: `${selectedMode}-${i}`,
            mode: selectedMode,
          })),
        }));
      } else {
        console.warn('⚠️ Search ile seçilen yere rota alınamadı');
      }
    }
  } catch (err) {
    console.warn('handleSelectPlace hata:', err);
  }
}, [fetchAndSetMarker, mapRef, fromLocation, selectedMode]);

  const handleCategorySelect = useCallback(
  async (type) => {
    // Aynı kategoriye tekrar tıklandıysa → KAPAT (toggle)
    if (type === activeCategory) {
      setActiveCategory(null);
      setQuery('');
      setMarker(null);
      setCategoryMarkers([]);
      setRouteCoords([]);
      setRouteInfo(null);
      setRouteDrawn(false);
      setMapMoved(false);
      return;
    }

    // Yeni kategori seçildi → TEMİZLE + YENİLE
    setActiveCategory(type);
    setQuery('');
    setMarker(null);
    setRouteCoords([]);
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
  // ➊ Seçilen routeId’den hem rota objesini hem de modunu bul
  let found;
  Object.entries(routeOptions).forEach(([mode, list]) => {
    list.forEach(r => {
      if (r.id === routeId) {
        found = { ...r, mode };
      }
    });
  });
  if (!found) return;

  // ➋ Seçili modu ve rota bilgilerini güncelle
  setSelectedMode(found.mode);
  setRouteCoords(found.decodedCoords);
  setRouteInfo({ distance: found.distance, duration: found.duration });

  // ➌ Yeni isPrimary atamaları
  setRouteOptions(prev => {
    const updated = { ...prev };
    updated[found.mode] = updated[found.mode].map(r => ({
      ...r,
      isPrimary: r.id === found.id,
    }));
    return updated;
  });
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
      setRouteCoords([]);
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
      setRouteCoords([]);
      setRouteInfo(null);
      setRouteDrawn(false);
      setMapMoved(false);


    // 1) Koordinatı normalize et (her formatı {latitude, longitude}'a çevir)
     const coord = normalizeCoord(coordinate);
     // 2) Marker'ı detaylarıyla çek (içeride de coords normalize edildiğinden emin ol)
     await fetchAndSetMarker(placeId, coord, fallbackName);
    // 3) Görünürlük/zoom: coord varsa sınır kontrolü yap
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
      // Harita sınırlarını alamıyorsak yine de zoom yap
      const newRegion = {
        latitude: coord.latitude,
        longitude: coord.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setRegion(newRegion);
      mapRef.current.animateToRegion(newRegion, 300);
    }

    // 4) RouteInfo için tek atışlık örnek (mevcut mantığınıza göre kaldırılabilir)
    try {
      if (coord) {
        const route = await getRoute(ANKARA_CENTER, coord);
        setRouteInfo(route);
      } else {
        setRouteInfo(null);
     }
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
    setRouteCoords([]);
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

     // 👇 POI’ye zoom ve merkezleme
  const newRegion = {
   latitude: coordinate.latitude,
   longitude: coordinate.longitude,
   latitudeDelta: 0.01,
   longitudeDelta: 0.01,
 };
 // state’i güncelle
 setRegion(newRegion);
 // haritayı animasyonla taşı
 requestAnimationFrame(() => {
   mapRef?.current?.animateToRegion(newRegion, 350);
 });

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
  // routeOptions dolu değilse atla
  if (!routeOptions || Object.keys(routeOptions).length === 0) return;
  const list = routeOptions[selectedMode] || [];
  const selected = list.find(r => r.isPrimary);
  console.log('🎯 Yeni mod için rota güncelleniyor:', selectedMode, selected);

  if (selected?.decodedCoords) {
    setRouteCoords(selected.decodedCoords);
    setRouteInfo({ distance: selected.distance, duration: selected.duration });
  } else {
    console.warn('⚠️ Seçilen mod için rota yok:', selectedMode);
  }
}, [selectedMode, routeOptions]);



  useEffect(() => {
    if (fromLocation?.coords && toLocation?.coords) {
      fetchAllRoutes(fromLocation.coords, toLocation.coords);
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
    setRouteInfo,
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
    setRouteOptions,
    handleSelectRoute,
    selectedMode,
    setSelectedMode,
    fetchAllRoutes,
  };
}
