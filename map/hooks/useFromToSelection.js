// src/hooks/useFromToSelection.js
import { useCallback } from 'react';

export function useFromToSelection({
  map,
  mapRef,
  setMode,
  sheetRef,
  normalizeCoord,
  toCoordsObject,
  reverseGeocode,
  getPlaceDetails,
  recalcRoute,

  // UI durumları (MapScreen tarafından yönetiliyor)
  overlayContext,
  setShowFromOverlay,
  setIsSelectingFromOnMap,
  setShowSelectionHint,

  // history
  History,
  HISTORY_KEYS,
  pushLabelHistory,

  // 👇 MapScreen'den gelen auto-open kontrol ref'i
  routeSheetAutoOpenRef,
}) {
  const setToFromMarkerIfMissing = useCallback(() => {
    if (map.toLocation) return;
    const c = normalizeCoord(
      map.marker?.coords ?? map.marker?.coordinate ?? map.marker?.geometry?.location ?? map.marker
    );
    if (!c) return;
    const desc =
      map.marker?.name ||
      map.marker?.formatted_address ||
      map.marker?.address ||
      'Seçilen Konum';

    map.setToLocation({ coords: c, description: desc, key: map.marker?.place_id || 'map' });
  }, [map, normalizeCoord]);

  const handleReverseRoute = useCallback(async () => {
    if (!map.fromLocation?.coords || !map.toLocation?.coords) return;
    const newFrom = map.toLocation;
    const newTo   = map.fromLocation;
    map.setFromLocation(newFrom);
    map.setToLocation(newTo);
    await recalcRoute(map.selectedMode);
  }, [map, recalcRoute]);

  const onGetDirectionsPress = useCallback(() => {
    // ✅ auto-open tetikle (ops. chaining KULLANMA)
    if (routeSheetAutoOpenRef) routeSheetAutoOpenRef.current = true;

    if (!map.toLocation && (map.marker?.coords || map.marker?.coordinate)) {
      const c = normalizeCoord(map.marker?.coords ?? map.marker?.coordinate);
      map.setToLocation({
        coords: c,
        description: map.marker.name || 'Seçilen Yer',
        key: map.marker.place_id || 'map',
      });
    }
    sheetRef.current?.close?.();
    setShowFromOverlay(true);
  }, [map, normalizeCoord, setShowFromOverlay, sheetRef, routeSheetAutoOpenRef]);

  const handleFromSelected = useCallback(async (src) => {
    // ✅ auto-open tetikle
    if (routeSheetAutoOpenRef) routeSheetAutoOpenRef.current = true;

    // “Haritadan seç” modu
    if (src.key === 'map') {
      setIsSelectingFromOnMap(true);
      setShowSelectionHint(true);
      return;
    }

    let address = src.description || 'Seçilen Konum';
    const placeId = src.key === 'map' || src.key === 'current' ? null : src.key;

    const srcCoord = normalizeCoord(src?.coords ?? src);
    if ((src.key === 'map' || src.key === 'current') && srcCoord) {
      try {
        const geo = await reverseGeocode(srcCoord);
        if (geo?.[0]) address = geo[0].formatted_address || address;
      } catch {}
    }

    const normFrom = toCoordsObject(src) ?? { ...src, coords: srcCoord };
    const fromSrc = { ...normFrom, description: address, key: src.key };

    map.setFromLocation(fromSrc);

    await History.pushLabel(HISTORY_KEYS.LABEL.ALL, fromSrc.description);
    await History.pushLabel(HISTORY_KEYS.LABEL.FROM, fromSrc.description);

    setMode('route');
    setToFromMarkerIfMissing();

    try {
      if (placeId) {
        await map.fetchAndSetMarker(placeId, fromSrc.coords, address);
      } else if (fromSrc.coords) {
        map.setMarker({ coords: fromSrc.coords, name: address, address });
      }
    } catch {}

    const fromC = normalizeCoord(fromSrc.coords);
    const toC =
      normalizeCoord(
        map.toLocation?.coords ??
        map.marker?.coordinate ??
        map.marker?.coords ??
        null
      );
    if (fromC && toC) {
      await recalcRoute(map.selectedMode, null, fromC, toC);
    }
  }, [
    map, setMode, setToFromMarkerIfMissing, normalizeCoord,
    reverseGeocode, toCoordsObject, recalcRoute, History, HISTORY_KEYS,
    setIsSelectingFromOnMap, setShowSelectionHint, routeSheetAutoOpenRef
  ]);

  const handleToSelected = useCallback(async (place) => {
    // ✅ auto-open tetikle
    if (routeSheetAutoOpenRef) routeSheetAutoOpenRef.current = true;

    try {
      const pid = place?.place_id || place?.id;
      let lat =
        place?.geometry?.location?.lat ??
        place?.location?.lat ??
        place?.coords?.latitude ??
        place?.lat;
      let lng =
        place?.geometry?.location?.lng ??
        place?.location?.lng ??
        place?.coords?.longitude ??
        place?.lng;
      let name = place?.name || place?.structured_formatting?.main_text || place?.description || 'Seçilen yer';
      let address = place?.vicinity || place?.formatted_address || place?.secondary_text || place?.description || '';

      if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && pid) {
        const d = await getPlaceDetails(pid);
        lat = d?.geometry?.location?.lat ?? lat;
        lng = d?.geometry?.location?.lng ?? lng;
        name = d?.name || name;
        address = d?.formatted_address || d?.vicinity || address;
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const coord = { latitude: lat, longitude: lng };
      const label = name || address || 'Seçilen Konum';

      map.setToLocation({ coords: coord, description: label, key: pid || 'map' });

      await pushLabelHistory('search_history', label);
      await pushLabelHistory('search_history_to', label);

      if (pid) {
        await map.fetchAndSetMarker(pid, coord, label);
      } else {
        map.setMarker({ coords: coord, name: label, address });
      }
      mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);

      setMode('route');
      const fromC = normalizeCoord(map.fromLocation?.coords);
      if (fromC) {
        await recalcRoute(map.selectedMode, null, fromC, coord);
      }
    } catch (e) {
      console.warn('handleToSelected error:', e);
    }
  }, [map, mapRef, normalizeCoord, recalcRoute, getPlaceDetails, pushLabelHistory, routeSheetAutoOpenRef]);

  // Haritadan tek dokunuşla from/to seçimi
  const handleSelectOriginOnMap = useCallback(async (coordinate) => {
    try {
      const geo = await reverseGeocode(coordinate);
      const address = geo?.[0]?.formatted_address || 'Seçilen Konum';
      const placeId = geo?.[0]?.place_id;
      let name = address;
      if (placeId) {
        try {
          const details = await getPlaceDetails(placeId);
          name = details?.name || address;
        } catch {}
      }
      const fromSrc = { coords: coordinate, description: name, key: placeId || 'map' };
      map.setFromLocation(fromSrc);
      await pushLabelHistory('search_history', name);
      await pushLabelHistory('search_history_from', name);
      setMode('route');
      setIsSelectingFromOnMap(false);
      const toC = normalizeCoord(map.toLocation?.coords);
      if (toC) await recalcRoute(map.selectedMode, null, normalizeCoord(coordinate), toC);
    } catch (e) {
      console.warn('select origin on map error:', e);
    }
  }, [map, setMode, setIsSelectingFromOnMap, reverseGeocode, getPlaceDetails, pushLabelHistory, normalizeCoord, recalcRoute]);

  const handleSelectDestinationOnMap = useCallback(async (coordinate) => {
    try {
      const geo = await reverseGeocode(coordinate);
      const address = geo?.[0]?.formatted_address || 'Seçilen Konum';
      const placeId = geo?.[0]?.place_id;
      let name = address;
      if (placeId) {
        try {
          const details = await getPlaceDetails(placeId);
          name = details?.name || address;
        } catch {}
      }
      const label = name;
      map.setToLocation({ coords: normalizeCoord(coordinate), description: label, key: placeId || 'map' });
      await History.pushLabel(HISTORY_KEYS.LABEL.ALL, label);
      await History.pushLabel(HISTORY_KEYS.LABEL.TO, label);
      setIsSelectingFromOnMap(false);
      const fromC = normalizeCoord(map.fromLocation?.coords);
      if (fromC) await recalcRoute(map.selectedMode, null, fromC, normalizeCoord(coordinate));
    } catch (e) {
      console.warn('select destination on map error:', e);
    }
  }, [map, setIsSelectingFromOnMap, reverseGeocode, getPlaceDetails, History, HISTORY_KEYS, normalizeCoord, recalcRoute]);

  const handleMapPress = useCallback((e) => {
    const { coordinate } = e.nativeEvent;
    if (map && overlayContext) {
      if (overlayContext === 'from') {
        handleSelectOriginOnMap(coordinate);
        return;
      }
      if (overlayContext === 'to') {
        handleSelectDestinationOnMap(coordinate);
        return;
      }
    }
    map.handleMapPress(e);
  }, [map, overlayContext, handleSelectOriginOnMap, handleSelectDestinationOnMap]);

  return {
    onGetDirectionsPress,
    handleFromSelected,
    handleToSelected,
    handleSelectOriginOnMap,
    handleSelectDestinationOnMap,
    handleMapPress,
    handleReverseRoute,
  };
}
