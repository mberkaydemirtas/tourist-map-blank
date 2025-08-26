// src/navigation/useNavPOI.js
import { useCallback, useMemo, useRef, useState } from 'react';
import { focusOn, fitBoundsToCoords } from './cameraUtils';

/**
 * Yol üstü POI arama + aday durak + ekleme akışı
 *
 * @param {{
 *  routeCoordsRef: React.MutableRefObject<Array<[number,number]>>,
 *  cameraRef: React.MutableRefObject<any>,
 *  pauseFollowing: (ms?:number)=>void,
 *  getNearbyPlaces: (args:{location:{lat:number,lng:number}, radius:number, type?:string, keyword?:string})=>Promise<any[]>,
 *  getPlaceDetails: (placeId:string)=>Promise<any>,
 *  onInsertStop: (p:{lat:number,lng:number,name?:string,place_id?:string,address?:string})=>void,
 *  metersBetween: (a:{lat:number,lng:number}, b:{lat:number,lng:number})=>number,
 *  distanceToPolylineMeters: (p:{lat:number,lng:number}, coords:any[])=>number,
 *  addStopOpen?: boolean,
 *  sampleEveryM?: number,
 *  nearbyRadiusM?: number,
 * }} params
 */
export default function useNavPOI({
  routeCoordsRef,
  cameraRef,
  pauseFollowing,
  getNearbyPlaces,
  getPlaceDetails,
  onInsertStop,
  metersBetween,
  distanceToPolylineMeters,
  addStopOpen = false,
  sampleEveryM = 900,
  nearbyRadiusM = 650,
}) {
  const [poiMarkers, setPoiMarkers] = useState([]);
  const [poiActive, setPoiActive] = useState({ type: null, query: null });
  const [selectedId, setSelectedId] = useState(null);
  const [candidateStop, setCandidateStop] = useState(null);

  const candidateStopRef = useRef(null);
  const addStopOpenRef = useRef(addStopOpen);
  const poiActiveRef = useRef(poiActive);

  const setCandidate = (v) => { candidateStopRef.current = v; setCandidateStop(v); };

  // ref’leri güncel tut
  addStopOpenRef.current = addStopOpen;
  poiActiveRef.current = poiActive;

  // Listeyi id’ye göre stabilize et (render performansı + sıralama)
  const stablePoiList = useMemo(() => {
    const arr = Array.isArray(poiMarkers) ? poiMarkers : [];
    return arr
      .map(p => ({ ...p, __id: p?.place_id || p?.id || `${p?.geometry?.location?.lng}_${p?.geometry?.location?.lat}` }))
      .sort((a, b) => (a.__id > b.__id ? 1 : -1));
  }, [poiMarkers]);

  // POI sonuçlarını kadraja al
  const flyToItemsBounds = useCallback((items) => {
    if (!cameraRef?.current) return;

    // Tek sonuçsa merkeze al
    if (Array.isArray(items) && items.length === 1) {
      const it = items[0];
      const lat = it?.geometry?.location?.lat ?? it?.lat ?? it?.coords?.latitude;
      const lng = it?.geometry?.location?.lng ?? it?.lng ?? it?.coords?.longitude;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        focusOn(cameraRef, pauseFollowing, lng, lat, 18);
      }
      return;
    }

    // Çok sonuçsa fit
    if (Array.isArray(items) && items.length > 1) {
      const coords = [];
      for (const it of items) {
        const lat = it?.geometry?.location?.lat ?? it?.lat ?? it?.coords?.latitude;
        const lng = it?.geometry?.location?.lng ?? it?.lng ?? it?.coords?.longitude;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          coords.push([lng, lat]);
        }
      }
      if (coords.length >= 2) {
        fitBoundsToCoords(cameraRef, pauseFollowing, coords, 60, 500);
      }
      return;
    }

    // Aksi halde mevcut rotayı göster (aday durak yoksa)
    if (!candidateStopRef.current && Array.isArray(routeCoordsRef?.current) && routeCoordsRef.current.length >= 2) {
      fitBoundsToCoords(cameraRef, pauseFollowing, routeCoordsRef.current, 50, 500);
    }
  }, [cameraRef, pauseFollowing, routeCoordsRef]);

  // Yol üstü POI tarayıcı
  const fetchPlacesAlongRoute = useCallback(async ({ type = null, text = null, noCorridor = false } = {}) => {
    const coords = routeCoordsRef?.current;
    if (!coords || coords.length < 2) { setPoiMarkers([]); return; }

    // örnekleme
    const samples = [];
    let acc = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const A = { lat: coords[i][1], lng: coords[i][0] };
      const B = { lat: coords[i + 1][1], lng: coords[i + 1][0] };
      const seg = metersBetween(A, B);
      if (acc === 0) samples.push(A);
      acc += seg;
      while (acc >= sampleEveryM) {
        acc -= sampleEveryM;
        const t = (seg - acc) / seg;
        const lat = A.lat + (B.lat - A.lat) * t;
        const lng = A.lng + (B.lng - A.lng) * t;
        samples.push({ lat, lng });
      }
    }
    samples.push({ lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] });

    // dedupe + koridor filtresi
    const seen = new Map();
    for (const s of samples) {
      try {
        const res = await getNearbyPlaces({
          location: { lat: s.lat, lng: s.lng },
          radius: nearbyRadiusM,
          type: type || undefined,
          keyword: text || undefined,
        });
        if (Array.isArray(res)) {
          for (const it of res) {
            const id = it?.place_id || it?.id;
            const lat = it?.geometry?.location?.lat;
            const lng = it?.geometry?.location?.lng;
            if (!id || typeof lat !== 'number' || typeof lng !== 'number') continue;
            if (seen.has(id)) continue;

            if (!!type && !noCorridor) {
              const d = distanceToPolylineMeters({ lat, lng }, coords);
              const corridorSlack = Math.max(nearbyRadiusM + 500, 1200);
              if (!Number.isFinite(d) || d > corridorSlack) continue;
            }
            seen.set(id, it);
          }
        }
      } catch {}
    }

    const list = Array.from(seen.values()).slice(0, 40);
    setPoiMarkers(list);
    flyToItemsBounds(list);
  }, [
    routeCoordsRef, metersBetween, getNearbyPlaces,
    nearbyRadiusM, sampleEveryM, distanceToPolylineMeters, flyToItemsBounds
  ]);

  // Dışa açık handler’lar
  const clearPoi = useCallback(() => {
    setPoiActive({ type: null, query: null });
    setPoiMarkers([]);
    setSelectedId(null);
    // aday durak yoksa rotayı fit et
    if (!candidateStopRef.current && Array.isArray(routeCoordsRef?.current) && routeCoordsRef.current.length >= 2) {
      fitBoundsToCoords(cameraRef, pauseFollowing, routeCoordsRef.current, 50, 500);
    }
  }, [cameraRef, pauseFollowing, routeCoordsRef]);

  const handleNavCategorySelect = useCallback(async (type) => {
    setPoiActive({ type, query: null });
    await fetchPlacesAlongRoute({ type, noCorridor: false });
  }, [fetchPlacesAlongRoute]);

  const handleQuerySubmit = useCallback(async (text) => {
    setPoiActive({ type: null, query: text });
    await fetchPlacesAlongRoute({ text, noCorridor: true });
  }, [fetchPlacesAlongRoute]);

  const onPoiPress = useCallback(async (it) => {
    const pid = it?.place_id || it?.id;
    const fLat = it?.geometry?.location?.lat;
    const fLng = it?.geometry?.location?.lng;
    setSelectedId(pid || `${fLng}_${fLat}`);
    setCandidate({
      lat: fLat, lng: fLng,
      name: it?.name || 'Seçilen yer',
      place_id: pid,
      rating: it?.rating ?? null,
      openNow: it?.opening_hours?.open_now ?? null,
      address: it?.vicinity || '',
    });

    if (Number.isFinite(fLat) && Number.isFinite(fLng)) {
      focusOn(cameraRef, pauseFollowing, fLng, fLat, 18);
    }

    try {
      if (pid) {
        const detail = await getPlaceDetails(pid);
        if (detail) {
          const dLat = detail?.geometry?.location?.lat ?? fLat;
          const dLng = detail?.geometry?.location?.lng ?? fLng;
          setCandidate(prev =>
            prev && (prev.place_id === pid)
              ? {
                  ...prev,
                  lat: dLat, lng: dLng,
                  name: detail?.name || prev.name,
                  rating: detail?.rating ?? prev.rating,
                  openNow: detail?.opening_hours?.open_now ?? prev.openNow,
                  address: detail?.formatted_address || detail?.vicinity || prev.address,
                }
              : prev
          );
        }
      }
    } catch {}
  }, [cameraRef, pauseFollowing, getPlaceDetails]);

  const handleAddStopFromPOI = useCallback(async (place) => {
    let lat, lng, name, place_id, address;

    if (place?.geometry?.location) {
      lat = place.geometry.location.lat;
      lng = place.geometry.location.lng;
      name = place.name || 'Seçilen yer';
      address = place.vicinity || place.formatted_address || '';
      place_id = place.place_id || place.id;
    } else if (candidateStopRef.current) {
      ({ lat, lng, name, place_id, address } = candidateStopRef.current);
    } else if (place?.place_id || place?.id) {
      const d = await getPlaceDetails(place.place_id || place.id);
      lat = d?.geometry?.location?.lat;
      lng = d?.geometry?.location?.lng;
      name = d?.name || 'Seçilen yer';
      address = d?.formatted_address || d?.vicinity || '';
      place_id = d?.place_id || place?.id;
    } else {
      return;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    onInsertStop?.({ lat, lng, name, place_id, address });

    // Temizlik
    setSelectedId(null);
    setCandidate(null);
    clearPoi();
  }, [getPlaceDetails, onInsertStop, clearPoi]);

  // Overlay için bounds
  const getRouteBounds = useCallback(() => {
    const coords = routeCoordsRef?.current;
    if (!coords || coords.length < 2) return null;
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const [lng, lat] of coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    const pad = 0.02;
    return {
      sw: { lat: minLat - pad, lng: minLng - pad },
      ne: { lat: maxLat + pad, lng: maxLng + pad },
    };
  }, [routeCoordsRef]);

  // isAddingStop durumu
  const isAddingStop = useMemo(
    () => !!(addStopOpen || selectedId || candidateStop || poiActive.type || poiActive.query),
    [addStopOpen, selectedId, candidateStop, poiActive]
  );

  return {
    poiActive,
    poiMarkers,
    stablePoiList,
    selectedId, setSelectedId,
    candidateStop, setCandidateStop: setCandidate,
    isAddingStop,
    clearPoi,
    handleNavCategorySelect,
    handleQuerySubmit,
    handleAddStopFromPOI,
    onPoiPress,
    getRouteBounds,
  };
}
