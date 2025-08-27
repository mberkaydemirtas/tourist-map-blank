// src/hooks/useRouteCancel.js
import { useCallback } from 'react';

export function useRouteCancel({
  setMode,
  map,
  setCandidateStop,
  setPoiMarkers,
  setRouteCoords,
  setRouteInfo,
  dismissRouteSheet,
  routeSheetPresentedRef,
}) {
  const handleCancelRoute = useCallback(() => {
    setMode('explore');
    map.setMarker(null);
    map.setFromLocation(null);
    map.setToLocation(null);
    map.setRouteOptions({});
    map.setWaypoints([]);
    setCandidateStop(null);
    setPoiMarkers([]);
    setRouteCoords([]);
    setRouteInfo(null);
    dismissRouteSheet();
    routeSheetPresentedRef.current = false;
  }, [
    setMode, map, setCandidateStop, setPoiMarkers,
    setRouteCoords, setRouteInfo, dismissRouteSheet, routeSheetPresentedRef
  ]);

  return { handleCancelRoute };
}
