import { useState, useCallback, useEffect } from 'react';
import { getRoute, decodePolyline } from '../../services/routeService';

export function useRouteLogic(mapRef) {
  const [selectedMode, setSelectedMode] = useState('driving'); // 'driving' | 'walking' | 'transit'
  const [routeOptions, setRouteOptions] = useState({});        // { driving: Route[], walking: Route[], transit: Route[] }
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);            // {distance, duration, distanceText, durationText, polyline}
  const [routeDrawn, setRouteDrawn] = useState(false);
  const [waypoints, setWaypoints] = useState([]);              // [{ latitude, longitude, ... }]
  const [phase, setPhase] = useState('from');                  // 'from' | 'to' | 'ready'
  const [fromLocation, setFromLocation] = useState(null);      // { description, coords, key }
  const [toLocation, setToLocation] = useState(null);          // { description, coords, key }

  const fitPolyline = useCallback((coords = []) => {
    if (!coords.length) return;
    mapRef?.current?.fitToCoordinates(coords, {
      edgePadding: { top: 60, left: 40, right: 40, bottom: 260 },
      animated: true,
    });
  }, [mapRef]);

  const makeRouteInfo = useCallback((r) => {
    if (!r) return null;
    const dist = Number(r.distance ?? 0);
    const dur  = Number(r.duration ?? 0);
    return {
      distance: dist,                  // metre
      duration: dur,                   // saniye
      distanceText: `${(dist / 1000).toFixed(1)} km`,
      durationText: `${Math.round(dur / 60)} dk`,
      polyline: r.polyline ?? null,
    };
  }, []);

  const calculateRouteSimple = useCallback(async () => {
    if (!fromLocation?.coords || !toLocation?.coords) return;
    const out = await getRoute(fromLocation.coords, toLocation.coords, selectedMode, { alternatives: true });
    const list = (Array.isArray(out) ? out : out ? [out] : [])
      .map((r, i) => ({
        ...r,
        decodedCoords: r.decodedCoords || decodePolyline(r.polyline || ''),
        id: `${selectedMode}-${i}`,
        isPrimary: i === 0,
        mode: selectedMode,
      }))
      .filter(r => (r.decodedCoords?.length ?? 0) > 1);

    setRouteOptions(prev => ({ ...prev, [selectedMode]: list }));

    const first = list[0];
    if (first) {
      setRouteCoords(first.decodedCoords);
      setRouteInfo({ distance: first.distance, duration: first.duration });
      fitPolyline(first.decodedCoords);
    } else {
      setRouteCoords([]);
      setRouteInfo(null);
    }
  }, [fromLocation, toLocation, selectedMode, fitPolyline]);

  const calculateRouteWithStops = useCallback(async ({ optimize = false } = {}) => {
    if (!fromLocation?.coords || !toLocation?.coords) return;
    const mode = (selectedMode === 'transit' && waypoints.length) ? 'driving' : selectedMode;

    const out = await getRoute(fromLocation.coords, toLocation.coords, mode, {
      alternatives: false,
      waypoints,
      optimize: !!optimize,
    });

    const list = (Array.isArray(out) ? out : out ? [out] : [])
      .map((r, i) => ({
        ...r,
        decodedCoords: r.decodedCoords || decodePolyline(r.polyline || ''),
        id: `${mode}-${i}`,
        isPrimary: i === 0,
        mode,
      }))
      .filter(r => (r.decodedCoords?.length ?? 0) > 1);

    const primary = list[0];
    if (primary?.waypointOrder?.length === waypoints.length) {
      setWaypoints(primary.waypointOrder.map(i => waypoints[i]));
    }

    setRouteOptions(prev => ({ ...prev, [mode]: list }));

    if (primary) {
      setRouteCoords(primary.decodedCoords);
      setRouteInfo({ distance: primary.distance, duration: primary.duration });
      fitPolyline(primary.decodedCoords);
    } else {
      setRouteCoords([]);
      setRouteInfo(null);
    }
  }, [fromLocation, toLocation, selectedMode, waypoints, fitPolyline]);

  useEffect(() => {
    if (!fromLocation?.coords || !toLocation?.coords) return;
    if (waypoints.length > 0) {
      calculateRouteWithStops({ optimize: false });
    } else {
      calculateRouteSimple();
    }
  }, [waypoints, fromLocation, toLocation, calculateRouteWithStops, calculateRouteSimple]);

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

  const fetchAllRoutes = useCallback(async (fromCoord, toCoord) => {
    const modes = ['driving', 'walking', 'transit'];
    const routeMap = {};

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

    const anyRoutes = Object.values(routeMap).flat();
    if (anyRoutes.length === 0) {
      setRouteOptions({});
      setRouteCoords([]);
      setRouteInfo(null);
      setRouteDrawn(false);
      return;
    }

    Object.entries(routeMap).forEach(([mode, list]) => {
      if (!list.length) return;
      const fastest = list.reduce((a, b) => (a.duration < b.duration ? a : b));
      routeMap[mode] = list.map(r => ({ ...r, isPrimary: r.id === fastest.id }));
    });

    setRouteOptions(routeMap);
    const drivingList = routeMap['driving'] || [];
    const drivingPrimary = drivingList.find(r => r.isPrimary);

    if (drivingPrimary) {
      setSelectedMode('driving');
      setRouteCoords(drivingPrimary.decodedCoords);
      setRouteInfo(makeRouteInfo(drivingPrimary));
      setRouteDrawn(true);
    } else {
      setRouteCoords([]);
      setRouteInfo(null);
      setRouteDrawn(false);
    }
  }, [makeRouteInfo]);

  const handleSelectFrom = useCallback((place) => {
    setFromLocation({
      description: place.description,
      coords: place.coords ?? place.coordinate,
      key: place.key || 'from',
    });
    setPhase('to');
  }, []);

  const handleSelectTo = useCallback(async (place) => {
    const to = {
      description: place.description,
      coords: place.coords ?? place.coordinate ?? place,
      key: place.key || 'to',
    };
    setToLocation(to);
    setPhase('ready');

    if (fromLocation?.coords && to?.coords) {
      await fetchAllRoutes(fromLocation.coords, to.coords);
    }
    setSelectedMode('driving');
  }, [fromLocation, fetchAllRoutes]);

  const handleSelectRoute = useCallback((routeId) => {
    let found;
    Object.entries(routeOptions).forEach(([mode, list]) => {
      list.forEach(r => {
        if (r.id === routeId) found = { ...r, mode };
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

  const handleDrawRoute = useCallback(() => {
    if (!routeInfo?.polyline) return;
    const coords = decodePolyline(routeInfo.polyline);
    setRouteCoords(coords);
    setRouteDrawn(true);
  }, [routeInfo]);

  // seçili mod değiştiğinde primary rotayı uygula
  useEffect(() => {
    const list = routeOptions?.[selectedMode];
    if (!Array.isArray(list) || list.length === 0) return;

    const selected = list.find(r => r.isPrimary) ?? list[0];
    if (selected?.decodedCoords?.length) {
      setRouteCoords(selected.decodedCoords);
      setRouteInfo(makeRouteInfo(selected));
      setRouteDrawn(true);
    } else {
      console.warn('⚠️ Seçilen mod için rota yok veya geometri eksik:', selectedMode);
      setRouteDrawn(false);
      setRouteCoords([]);
      setRouteInfo(null);
    }
  }, [selectedMode, routeOptions, makeRouteInfo]);

  return {
    // state
    selectedMode, setSelectedMode,
    routeOptions, setRouteOptions,
    routeCoords, setRouteCoords,
    routeInfo, setRouteInfo,
    routeDrawn, setRouteDrawn,
    waypoints, setWaypoints,
    phase,
    fromLocation, setFromLocation,
    toLocation, setToLocation,

    // helpers
    makeRouteInfo,
    calculateRouteSimple,
    calculateRouteWithStops,
    getRouteBetween,
    fetchAllRoutes,
    handleSelectFrom,
    handleSelectTo,
    handleSelectRoute,
    handleDrawRoute,
  };
}