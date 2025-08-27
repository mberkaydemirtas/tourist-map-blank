// src/hooks/usePoiAlongRoute.js
import { useCallback, useMemo, useState } from 'react';
import { meters } from '../utils/geo';
import { getNearbyPlaces, getPlaceDetails } from '../maps';

/** MapScreen’den bağımsız rota koridoru POI taraması + aday durak seçimi. */
export function usePoiAlongRoute(routeCoords, mapRef) {
  const [candidateStop, setCandidateStop] = useState(null);
  const [poiMarkers, setPoiMarkers] = useState([]);

  const idOf = (p) =>
    p?.place_id || p?.id || `${p?.geometry?.location?.lng}_${p?.geometry?.location?.lat}`;

  const distanceToRoute = useCallback((user, coordsLL) => {
    if (!coordsLL || coordsLL.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 0; i < coordsLL.length - 1; i++) {
      const A = { lat: coordsLL[i].latitude ?? coordsLL[i].lat, lng: coordsLL[i].longitude ?? coordsLL[i].lng };
      const B = { lat: coordsLL[i + 1].latitude ?? coordsLL[i + 1].lat, lng: coordsLL[i + 1].longitude ?? coordsLL[i + 1].lng };
      const mid = { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 };
      const d = meters(user, mid);
      if (d < best) best = d;
      if (best < 5) break;
    }
    return best;
  }, []);

  const fetchPlacesAlongRoute = useCallback(
    async ({ type = null, text = null, noCorridor = false } = {}) => {
      const coordsLL = routeCoords;
      if (!coordsLL || coordsLL.length < 2) {
        setPoiMarkers([]);
        return;
      }
      const SAMPLE_EVERY_M = 900;
      const NEARBY_RADIUS_M = 650;

      const samples = [];
      let acc = 0;
      for (let i = 0; i < coordsLL.length - 1; i++) {
        const A = { lat: coordsLL[i].latitude ?? coordsLL[i].lat, lng: coordsLL[i].longitude ?? coordsLL[i].lng };
        const B = { lat: coordsLL[i + 1].latitude ?? coordsLL[i + 1].lat, lng: coordsLL[i + 1].longitude ?? coordsLL[i + 1].lng };
        const seg = meters(A, B);
        if (acc === 0) samples.push(A);
        acc += seg;
        while (acc >= SAMPLE_EVERY_M) {
          acc -= SAMPLE_EVERY_M;
          const t = (seg - acc) / seg;
          samples.push({ lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t });
        }
      }
      const last = coordsLL[coordsLL.length - 1];
      samples.push({ lat: last.latitude ?? last.lat, lng: last.longitude ?? last.lng });

      const seen = new Map();
      for (const s of samples) {
        try {
          const res = await getNearbyPlaces({
            location: { lat: s.lat, lng: s.lng },
            radius: NEARBY_RADIUS_M,
            type: type || undefined,
            keyword: text || undefined,
          });
          if (Array.isArray(res)) {
            for (const it of res) {
              const id = it.place_id || it.id;
              const lat = it?.geometry?.location?.lat;
              const lng = it?.geometry?.location?.lng;
              if (!id || typeof lat !== 'number' || typeof lng !== 'number') continue;
              if (seen.has(id)) continue;

              if (!!type && !noCorridor) {
                const d = distanceToRoute({ lat, lng }, coordsLL);
                const slack = Math.max(NEARBY_RADIUS_M + 500, 1200);
                if (!Number.isFinite(d) || d > slack) continue;
              }
              seen.set(id, it);
            }
          }
        } catch {}
      }
      const list = Array.from(seen.values()).slice(0, 40);
      setPoiMarkers(list);

      if (list.length > 0) {
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        for (const it of list) {
          const lat = it?.geometry?.location?.lat, lng = it?.geometry?.location?.lng;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
        }
        if (minLat <= maxLat && minLng <= maxLng) {
          mapRef.current?.animateToRegion(
            {
              latitude: (minLat + maxLat) / 2,
              longitude: (minLng + maxLng) / 2,
              latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.2),
              longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.2),
            },
            500
          );
        }
      }
    },
    [routeCoords, distanceToRoute, mapRef]
  );

  const onPoiPress = useCallback(async (it) => {
    const pid = it?.place_id || it?.id;
    const lat = it?.geometry?.location?.lat;
    const lng = it?.geometry?.location?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    setCandidateStop({
      lat, lng,
      name: it?.name || 'Seçilen yer',
      place_id: pid,
      rating: it?.rating ?? null,
      address: it?.vicinity || '',
    });

    try {
      if (pid) {
        const d = await getPlaceDetails(pid);
        setCandidateStop(prev =>
          prev && prev.place_id === pid
            ? {
                ...prev,
                lat: d?.geometry?.location?.lat ?? lat,
                lng: d?.geometry?.location?.lng ?? lng,
                name: d?.name || prev.name,
                address: d?.formatted_address || d?.vicinity || prev.address,
              }
            : prev
        );
      }
    } catch {}
  }, []);

  const stablePoiList = useMemo(() => {
    const arr = Array.isArray(poiMarkers) ? poiMarkers : [];
    return arr
      .map(p => ({ ...p, __id: idOf(p) }))
      .sort((a, b) => (a.__id > b.__id ? 1 : -1));
  }, [poiMarkers]);

  return {
    candidateStop,
    setCandidateStop,
    poiMarkers,
    setPoiMarkers,
    stablePoiList,
    fetchPlacesAlongRoute,
    onPoiPress,
  };
}
