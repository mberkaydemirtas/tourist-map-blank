// src/hooks/useStopsEditor.js
import { useCallback, useState } from 'react';

const clamp = (min, max, v) => Math.min(max, Math.max(min, v));
const toLL = (p) => ({ lat: p.lat ?? p.latitude, lng: p.lng ?? p.longitude });

export function useStopsEditor({
  map,
  mapRef,            // 👈 eklendi
  recalcRoute,
  setMode,

  candidateStop,
  setCandidateStop,
  setPoiMarkers,

  History,
  HISTORY_KEYS,
  getPlaceDetails,
  autocomplete,
}) {
  const [addStopOpen, setAddStopOpen] = useState(false);
  const [editStopsOpen, setEditStopsOpen] = useState(false);
  const [draftStops, setDraftStops] = useState([]);
  const [pendingEditOp, setPendingEditOp] = useState(null);

  const confirmEditStops = useCallback(() => {
    if (!draftStops || draftStops.length < 2) return;
    const newWps = draftStops.slice(1, -1);
    map.setWaypoints(newWps);
    setEditStopsOpen(false);
    recalcRoute(map.selectedMode, newWps);
  }, [draftStops, map, recalcRoute]);

  const normalizePlaceToStop = useCallback(async (place) => {
    try {
      let lat, lng, name, place_id, address;

      if (typeof place === 'string') {
        const preds = await autocomplete(place);
        const pid = preds?.[0]?.place_id;
        if (!pid) return null;
        const d = await getPlaceDetails(pid);
        place_id = d?.place_id || pid;
        lat = d?.geometry?.location?.lat;
        lng = d?.geometry?.location?.lng;
        name = d?.name || preds?.[0]?.structured_formatting?.main_text || place;
        address = d?.formatted_address || preds?.[0]?.description || '';
      } else if (place?.geometry?.location || place?.coords || (Number.isFinite(place?.lat) && Number.isFinite(place?.lng))) {
        place_id = place?.place_id || place?.id || null;
        lat =
          place?.geometry?.location?.lat ??
          place?.coords?.latitude ??
          place?.lat;
        lng =
          place?.geometry?.location?.lng ??
          place?.coords?.longitude ??
          place?.lng;
        name =
          place?.name ||
          place?.structured_formatting?.main_text ||
          place?.description ||
          place?.address ||
          'Seçilen yer';
        address =
          place?.vicinity ||
          place?.formatted_address ||
          place?.structured_formatting?.secondary_text ||
          place?.address ||
          '';
      } else if (place?.place_id || place?.id) {
        const pid = place.place_id || place.id;
        const d = await getPlaceDetails(pid);
        place_id = d?.place_id || pid;
        lat = d?.geometry?.location?.lat;
        lng = d?.geometry?.location?.lng;
        name = d?.name || place?.name || 'Seçilen yer';
        address = d?.formatted_address || d?.vicinity || place?.description || '';
      } else if (candidateStop) {
        const { lat: clat, lng: clng, name: cname, place_id: cpid, address: caddr } = candidateStop;
        lat = clat; lng = clng; name = cname; place_id = cpid; address = caddr;
      } else {
        return null;
      }

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng, name, address, place_id: place_id || null };
    } catch {
      return null;
    }
  }, [candidateStop, autocomplete, getPlaceDetails]);

  const applyPendingEditStop = useCallback((payload) => {
    if (!pendingEditOp || !payload) return;
    setDraftStops(prev => {
      if (!Array.isArray(prev) || prev.length < 2) return prev;
      const lastIdx = prev.length - 1;

      if (pendingEditOp.type === 'insert') {
        const idx = clamp(1, lastIdx, pendingEditOp.index);
        const next = [...prev];
        next.splice(idx, 0, payload);
        return next;
      }
      if (pendingEditOp.type === 'replace') {
        const idx = clamp(1, lastIdx - 1, pendingEditOp.index);
        const next = [...prev];
        next[idx] = payload;
        return next;
      }
      return prev;
    });
    setPendingEditOp(null);
    setAddStopOpen(false);
    setEditStopsOpen(true);
    setCandidateStop(null);
    setPoiMarkers([]);
  }, [pendingEditOp, setCandidateStop, setPoiMarkers]);

  const animateTo = useCallback((lat, lng) => {
    try {
      mapRef?.current?.animateToRegion({
        latitude: lat, longitude: lng, latitudeDelta: 0.01, longitudeDelta: 0.01,
      }, 450);
    } catch {}
  }, [mapRef]);

  const insertOrAppendStop = useCallback(
    ({ lat, lng, name, place_id, address }) => {
      const payload = { lat, lng, name, place_id, address };
      const cur = Array.isArray(map.waypoints) ? map.waypoints : [];
      const wps = [...cur, payload];
      map.setWaypoints(wps);

      // ✅ haritayı hemen yeni durağa götür
      animateTo(lat, lng);

      setCandidateStop(null);
      setAddStopOpen(false);
      setPoiMarkers([]);
      setMode('route');
      recalcRoute(map.selectedMode, wps);
    },
    [map, recalcRoute, setMode, setCandidateStop, setPoiMarkers, animateTo]
  );

  const handleAddStopFlexible = useCallback(
    async (place) => {
      const payload = await normalizePlaceToStop(place);
      if (!payload) return;

      if (pendingEditOp) {
        applyPendingEditStop(payload);
      } else {
        insertOrAppendStop(payload);
        // History utils: kalmaya devam (ayrıca AddStopOverlay kendi local geçmişini tutuyor)
        await History.savePlaceToMany([HISTORY_KEYS.PLACE.ROUTE_STOP], payload);
      }
    },
    [pendingEditOp, normalizePlaceToStop, applyPendingEditStop, insertOrAppendStop, History, HISTORY_KEYS]
  );

  const handlePickStop = useCallback(
    async (place) => {
      try {
        const payload = await normalizePlaceToStop(place);
        if (!payload) return;
        if (pendingEditOp) {
          applyPendingEditStop(payload);
        } else {
          setCandidateStop(payload);
          // ✅ aday durak seçildiğinde de anında pan
          animateTo(payload.lat, payload.lng);
        }
      } catch {}
    },
    [normalizePlaceToStop, pendingEditOp, applyPendingEditStop, setCandidateStop, animateTo]
  );

  const openEditStops = useCallback(() => {
    if (!map.fromLocation?.coords || !map.toLocation?.coords) return;

    const from = {
      ...toLL(map.fromLocation.coords),
      name: map.fromLocation?.description || 'Başlangıç',
      place_id: map.fromLocation?.key || null,
      address: map.fromLocation?.description || '',
    };
    const to = {
      ...toLL(map.toLocation.coords),
      name: map.toLocation?.description || 'Bitiş',
      place_id: map.toLocation?.key || null,
      address: map.toLocation?.description || '',
    };
    const wps = (map.waypoints || []).map(w => ({
      lat: w.lat ?? w.latitude,
      lng: w.lng ?? w.longitude,
      name: w.name,
      address: w.address,
      place_id: w.place_id,
    }));

    setDraftStops([from, ...wps, to]);
    setEditStopsOpen(true);
  }, [map]);

  const onDragEnd = useCallback((from, to) => {
    setDraftStops(prev => {
      if (from === to) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  }, []);

  const onDelete = useCallback((i) => {
    setDraftStops(prev => {
      const last = (prev?.length ?? 0) - 1;
      if (i <= 0 || i >= last) return prev;
      return prev.filter((_, idx) => idx !== i);
    });
  }, []);

  const onInsertAt = useCallback((i) => {
    const last = (draftStops?.length ?? 0) - 1;
    const target = clamp(1, last, i - 1);
    setPendingEditOp({ type: 'insert', index: target });
    setAddStopOpen(true);
    setEditStopsOpen(false);
  }, [draftStops]);

  const onReplaceAt = useCallback((i) => {
    const last = (draftStops?.length ?? 0) - 1;
    if (i <= 0 || i >= last) return;
    setPendingEditOp({ type: 'replace', index: i });
    setAddStopOpen(true);
    setEditStopsOpen(false);
  }, [draftStops]);

  return {
    addStopOpen, setAddStopOpen,
    editStopsOpen, setEditStopsOpen,
    draftStops, setDraftStops,
    pendingEditOp, setPendingEditOp,

    openEditStops,
    handleAddStopFlexible,
    handlePickStop,
    confirmEditStops,

    onDragEnd,
    onDelete,
    onInsertAt,
    onReplaceAt,
  };
}
