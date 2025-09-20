// map/hooks/useRouteLogic.js
import { useState, useCallback, useEffect } from 'react';
import {
  decodePolyline,
  getNormalizedRoutes,
  getAllModesNormalized,
} from '../../trips/services/routeService';

export function useRouteLogic(mapRef) {
  const [selectedMode, setSelectedMode] = useState('driving');
  const [routeOptions, setRouteOptions] = useState({});
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeDrawn, setRouteDrawn] = useState(false);
  const [waypoints, setWaypoints] = useState([]);
  const [phase, setPhase] = useState('from');
  const [fromLocation, setFromLocation] = useState(null);
  const [toLocation, setToLocation] = useState(null);

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
      distance: dist,
      duration: dur,
      distanceText: `${(dist / 1000).toFixed(1)} km`,
      durationText: `${Math.round(dur / 60)} dk`,
      polyline: r.polyline ?? null,
    };
  }, []);

  const calculateRouteSimple = useCallback(async () => {
    if (!fromLocation?.coords || !toLocation?.coords) return;

    const list = await getNormalizedRoutes({
      from: fromLocation.coords,
      to: toLocation.coords,
      mode: selectedMode,
      options: { alternatives: true },
    });

    setRouteOptions((prev) => ({ ...prev, [selectedMode]: list }));

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

    const list = await getNormalizedRoutes({
      from: fromLocation.coords,
      to: toLocation.coords,
      mode,
      options: { alternatives: false, waypoints, optimize: !!optimize },
    });

    const primary = list[0];
    if (primary?.waypointOrder?.length === waypoints.length) {
      setWaypoints(primary.waypointOrder.map((i) => waypoints[i]));
    }

    setRouteOptions((prev) => ({ ...prev, [mode]: list }));

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
    const list = await getNormalizedRoutes({ from: startCoord, to: destCoord, mode });
    const primary = list[0];
    if (!primary) {
      setRouteInfo(null);
      setRouteCoords([]);
      setRouteDrawn(false);
      return;
    }
    setRouteInfo(makeRouteInfo(primary));
    setRouteCoords(primary.decodedCoords);
    setRouteDrawn(true);
  }, [makeRouteInfo]);

  const fetchAllRoutes = useCallback(async (fromCoord, toCoord) => {
    const routeMap = await getAllModesNormalized({ from: fromCoord, to: toCoord });

    // hiç rota yoksa temizle
    const any = Object.values(routeMap).flat();
    if (any.length === 0) {
      setRouteOptions({});
      setRouteCoords([]);
      setRouteInfo(null);
      setRouteDrawn(false);
      return;
    }

    // her modda en hızlıyı primary yap
    Object.entries(routeMap).forEach(([mode, list]) => {
      if (!list?.length) return;
      const fastest = list.reduce((a, b) => (a.duration < b.duration ? a : b));
      routeMap[mode] = list.map((r) => ({ ...r, isPrimary: r.id === fastest.id }));
    });

    setRouteOptions(routeMap);

    // driving varsa onu çiz
    const driving = routeMap.driving || [];
    const primary = driving.find((r) => r.isPrimary);
    if (primary) {
      setSelectedMode('driving');
      setRouteCoords(primary.decodedCoords);
      setRouteInfo(makeRouteInfo(primary));
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
      list?.forEach((r) => { if (r.id === routeId) found = { ...r, mode }; });
    });
    if (!found) return;

    setSelectedMode(found.mode);
    setRouteCoords(found.decodedCoords);
    setRouteInfo(makeRouteInfo(found));

    setRouteOptions((prev) => {
      const updated = { ...prev };
      updated[found.mode] = updated[found.mode].map((r) => ({
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

  useEffect(() => {
    const list = routeOptions?.[selectedMode];
    if (!Array.isArray(list) || list.length === 0) return;
    const selected = list.find((r) => r.isPrimary) ?? list[0];
    if (selected?.decodedCoords?.length) {
      setRouteCoords(selected.decodedCoords);
      setRouteInfo(makeRouteInfo(selected));
      setRouteDrawn(true);
    } else {
      setRouteDrawn(false);
      setRouteCoords([]);
      setRouteInfo(null);
    }
  }, [selectedMode, routeOptions, makeRouteInfo]);

  return {
    selectedMode, setSelectedMode,
    routeOptions, setRouteOptions,
    routeCoords, setRouteCoords,
    routeInfo, setRouteInfo,
    routeDrawn, setRouteDrawn,
    waypoints, setWaypoints,
    phase,
    fromLocation, setFromLocation,
    toLocation, setToLocation,

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
