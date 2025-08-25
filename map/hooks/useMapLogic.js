import { useState, useCallback, useRef, useEffect } from 'react';
import { Alert } from 'react-native';
import {
  getPlaceDetails,
  getNearbyPlaces,
  getAddressFromCoords,
  getRoute,
  decodePolyline,
} from '../maps';
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
  const [selectedMode, setSelectedMode] = useState('driving'); // ✅ varsayılan
  const [marker, setMarker] = useState(null);
  const [categoryMarkers, setCategoryMarkers] = useState([]);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeDrawn, setRouteDrawn] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const [mapMoved, setMapMoved] = useState(false);
  const [routeOptions, setRouteOptions] = useState({});

  const [waypoints, setWaypoints] = useState([]); // [{latitude, longitude, name?, place_id?}]

  const fitPolyline = useCallback((coords=[]) => {
    if (!coords.length) return;
    mapRef?.current?.fitToCoordinates(coords, {
      edgePadding: { top: 60, left: 40, right: 40, bottom: 260 },
      animated: true,
    });
  }, [mapRef]);

  const calculateRouteSimple = useCallback(async () => {
    if (!fromLocation?.coords || !toLocation?.coords) return;
    const out = await getRoute(fromLocation.coords, toLocation.coords, selectedMode, { alternatives: true });
    const first = Array.isArray(out) ? out[0] : out;
    const decoded = first?.decodedCoords?.map(p => ({ latitude: p.latitude, longitude: p.longitude })) || [];
    setRouteCoords(decoded);
    setRouteInfo(first ? { distanceValue: first.distance, durationValue: first.duration } : null);
    fitPolyline(decoded);
  }, [fromLocation, toLocation, selectedMode, fitPolyline]);

  const calculateRouteWithStops = useCallback(async ({ optimize=false } = {}) => {
    if (!fromLocation?.coords || !toLocation?.coords) return;
    const mode = (selectedMode === 'transit' && waypoints.length) ? 'driving' : selectedMode;

    const out = await getRoute(
      fromLocation.coords,
      toLocation.coords,
      mode,
      {
        alternatives: false,
        waypoints,             // 👈 {latitude, longitude}
        optimize: !!optimize,
      }
    );
    const first = Array.isArray(out) ? out[0] : out;

    // optimize:true ise waypoint_order gelebilir -> sadece ara durakları sırala
    if (first?.waypointOrder?.length === waypoints.length) {
      setWaypoints(first.waypointOrder.map(i => waypoints[i]));
      
    }

    const decoded = first?.decodedCoords?.map(p => ({ latitude: p.latitude, longitude: p.longitude })) || [];
    setRouteCoords(decoded);
    setRouteInfo(first ? { distanceValue: first.distance, durationValue: first.duration } : null);
    fitPolyline(decoded);
  }, [fromLocation, toLocation, selectedMode, waypoints, fitPolyline]);

  useEffect(() => {
    if (!fromLocation?.coords || !toLocation?.coords) return;
    if (waypoints.length > 0) {
      calculateRouteWithStops({ optimize: false });
    } else {
      calculateRouteSimple();
    }
  }, [waypoints, fromLocation, toLocation, calculateRouteWithStops, calculateRouteSimple]);

  const onRegionChange = useCallback((newRegion) => {
    setRegion(newRegion);
    setMapMoved(true);
  }, []);

  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const [phase, setPhase] = useState('from');          // 'from' | 'to' | 'ready'
  const [fromLocation, setFromLocation] = useState(null);
  const [toLocation, setToLocation] = useState(null);

  const lastPlacesKey = useRef(null);

  // 👇 Tek yerden km & dk formatı (polyline'ı da koruyoruz)
  const makeRouteInfo = useCallback((r) => {
    if (!r) return null;
    const dist = Number(r.distance ?? 0);
    const dur = Number(r.duration ?? 0);
    return {
      distance: dist,                           // metre
      duration: dur,                            // saniye
      distanceText: `${(dist / 1000).toFixed(1)} km`,
      durationText: `${Math.round(dur / 60)} dk`,
      polyline: r.polyline ?? null,
    };
  }, []);

  const getRouteBetween = useCallback(async (startCoord, destCoord, mode = 'driving') => {
    try {
      const routes = await getRoute(startCoord, destCoord, mode);
      if (!routes?.length) {
        setRouteInfo(null);
        setRouteCoords([]);
        setRouteDrawn(false);
        return;
      }
      const primary = routes[0];
      setRouteInfo(makeRouteInfo(primary));
      const coords = decodePolyline(primary.polyline);
      setRouteCoords(coords);
      setRouteDrawn(true);
    } catch (e) {
      console.warn('🛑 Rota alınamadı:', e);
      setRouteInfo(null);
      setRouteCoords([]);
      setRouteDrawn(false);
    }
  }, [makeRouteInfo]);

  const handleSelectFrom = useCallback(place => {
    setFromLocation({
      description: place.description,
      coords: place.coords ?? place.coordinate,
      key: place.key || 'from',
    });
    setPhase('to');
  }, []);

  // ✅ KURAL: Başlangıçta MODU OTOMATİK DEĞİŞTİRME!
  // Tüm modlar için rotaları getir, ama görüntülemeyi DRIVING önceliğiyle yap.
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
        isPrimary: false,
        mode,
      }));
    }

    // 2) Hiç rota yoksa state temizle
    const anyRoutes = Object.values(routeMap).flat();
    if (anyRoutes.length === 0) {
      setRouteOptions({});
      setRouteCoords([]);
      setRouteInfo(null);
      setRouteDrawn(false);
      return;
    }

    // 3) Her modun kendi en hızlısını işaretle (duration kullan)
    Object.entries(routeMap).forEach(([mode, list]) => {
      if (!list.length) return;
      const fastest = list.reduce((a, b) => (a.duration < b.duration ? a : b));
      routeMap[mode] = list.map(r => ({ ...r, isPrimary: r.id === fastest.id }));
    });

    // 4) Görüntüleme mantığı: DRIVING varsa onu çiz. Yoksa modu değiştirme.
    setRouteOptions(routeMap);

    const drivingList = routeMap['driving'] || [];
    const drivingPrimary = drivingList.find(r => r.isPrimary);

    if (drivingPrimary) {
      setSelectedMode('driving'); // sabitle
      setRouteCoords(drivingPrimary.decodedCoords);
      setRouteInfo(makeRouteInfo(drivingPrimary));
      setRouteDrawn(true);
    } else {
      setRouteCoords([]);
      setRouteInfo(null);
      setRouteDrawn(false);
    }
  };

  const handleSelectTo = useCallback(async place => {
    const to = {
      description: place.description,
      coords: normalizeCoord(place.coords ?? place.coordinate ?? place),
      key: place.key || 'to',
    };

      setToLocation(to);
  setPhase('ready');
  setActiveCategory(null);
  setCategoryMarkers([]);

  // önce rotaları çek
  if (fromLocation?.coords && to?.coords) {
    await fetchAllRoutes(fromLocation.coords, to.coords);
  }
  // sonra modu driving'e getir (artık routeOptions hazır)
  setSelectedMode('driving');
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

        return coord;
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

      // 🧭 fromLocation varsa seçilen yere rota oluştur (mevcut moda göre)
      const fromCoord = normalizeCoord(fromLocation?.coords);
      if (fromCoord) {
        const routes = await getRoute(fromCoord, coord, selectedMode || 'driving');

        if (routes?.length) {
          const primary = routes[0];
          const decoded = decodePolyline(primary.polyline || '');

          setRouteCoords(decoded);
          setRouteInfo(makeRouteInfo(primary));
          setRouteDrawn(true);

          setRouteOptions(prev => ({
            ...prev,
            [selectedMode || 'driving']: routes.map((r, i) => ({
              ...r,
              decodedCoords: decodePolyline(r.polyline || ''),
              isPrimary: i === 0,
              id: `${selectedMode || 'driving'}-${i}`,
              mode: selectedMode || 'driving',
            })),
          }));
        } else {
          console.warn('⚠️ Search ile seçilen yere rota alınamadı');
        }
      }
    } catch (err) {
      console.warn('handleSelectPlace hata:', err);
    }
  }, [fetchAndSetMarker, mapRef, fromLocation, selectedMode, makeRouteInfo]);

  const handleCategorySelect = useCallback(
    async (type) => {
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

      const newMarkers = await getNearbyPlaces(center, activeCategory);
      console.log('🔁 Bölge Tara Sonuçları:', newMarkers);

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
      }
    } catch (err) {
      console.warn('🔴 Bölge tara hatası:', err);
    } finally {
      setMapMoved(false);
      setLoadingCategory(false);
    }
  }, [activeCategory, categoryMarkers, region, mapRef]);

  const handleSelectRoute = useCallback((routeId) => {
    let found;
    Object.entries(routeOptions).forEach(([mode, list]) => {
      list.forEach(r => {
        if (r.id === routeId) {
          found = { ...r, mode };
        }
      });
    });
    if (!found) return;

    setSelectedMode(found.mode);
    setRouteCoords(found.decodedCoords);
    setRouteInfo(makeRouteInfo(found));

    setRouteOptions(prev => {
      const updated = { ...prev };
      updated[found.mode] = updated[found.mode].map(r => ({
        ...r,
        isPrimary: r.id === found.id,
      }));
      return updated;
    });
  }, [routeOptions, makeRouteInfo]);

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
        const routes = await getRoute(ANKARA_CENTER, { latitude, longitude }, selectedMode || 'driving');
        if (routes?.length) {
          setRouteInfo(makeRouteInfo(routes[0]));
        } else {
          setRouteInfo(null);
        }
      } catch {
        setRouteInfo(null);
      }
    },
    [fetchAndSetMarker, selectedMode, makeRouteInfo]
  );

  const handleMarkerSelect = useCallback(
    async (placeId, coordinate, fallbackName = '') => {
      setRouteCoords([]);
      setRouteInfo(null);
      setRouteDrawn(false);
      setMapMoved(false);

      const coord = normalizeCoord(coordinate);
      await fetchAndSetMarker(placeId, coord, fallbackName);

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
          const routes = await getRoute(ANKARA_CENTER, coord, selectedMode || 'driving');
          if (routes?.length) {
            setRouteInfo(makeRouteInfo(routes[0]));
          } else {
            setRouteInfo(null);
          }
        } else {
          setRouteInfo(null);
        }
      } catch {
        setRouteInfo(null);
      }
    },
    [fetchAndSetMarker, mapRef, selectedMode, makeRouteInfo]
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
        const routes = await getRoute(ANKARA_CENTER, coordinate, selectedMode || 'driving');
        if (routes?.length) {
          setRouteInfo(makeRouteInfo(routes[0]));
        } else {
          setRouteInfo(null);
        }
      } catch {
        setRouteInfo(null);
      }
    },
    [fetchAndSetMarker, selectedMode, makeRouteInfo]
  );

  // Seçilen mod değiştiğinde o modun primary rotasını uygula (varsa)
useEffect(() => {
  // routeOptions henüz yüklenmediyse hiç dokunma
  const list = routeOptions?.[selectedMode];
  if (!Array.isArray(list) || list.length === 0) {
    return; // ❌ UYARMA, STATE SİLME — sadece veri gelsin diye bekle
  }

  // Primary yoksa ilk rotayı fallback olarak seç
  const selected = list.find(r => r.isPrimary) ?? list[0];

  if (selected?.decodedCoords?.length) {
    setRouteCoords(selected.decodedCoords);
    setRouteInfo(makeRouteInfo(selected));
    setRouteDrawn(true);
  } else {
    // Bu noktaya geldiysek gerçekten bir veri tutarsızlığı vardır
    console.warn('⚠️ Seçilen mod için rota yok veya geometri eksik:', selectedMode);
    setRouteDrawn(false);
    setRouteCoords([]);
    setRouteInfo(null);
  }
}, [selectedMode, routeOptions, makeRouteInfo]);

  return {
    fetchAndSetMarker,
    setMarker,
    routeCoords,
    region,
    setRegion,
    onRegionChange,
    setRouteCoords,
    waypoints, 
    setWaypoints,
    calculateRouteWithStops,
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
