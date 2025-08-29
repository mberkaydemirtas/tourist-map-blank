// src/navigation/hooks/useRouteRecalc.js
import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Rota hesaplama ve yeniden-hesaplama (re-route) akışını soyutlar.
 *
 * Beklenen route sağlayıcı arayüzü:
 * - getRoute(fromLL, toLL, mode, opts)  -> routes[]
 * - decodePolyline(polylineStr)         -> [{latitude, longitude}, ...]
 * - getTurnByTurnSteps(fromLL, toLL)    -> provider steps[]
 *
 * Hook, "ekran" tarafındaki bazı durumları resetlemek için onRouteReset çağırır,
 * adım listesini güncellemek için setSteps callback'ini kullanır.
 */
export default function useRouteRecalc({
  from,
  to,
  mode = 'driving',
  baseRouteCoordinates = [],
  waypointsRef,            // ref.current -> [{lat,lng,...}]
  cameraRef,               // { fitBounds([neLng,neLat],[swLng,swLat],pad,dur) }
  poiActiveRef,            // { current: { type, query } }
  addStopOpenRef,          // { current: boolean }
  pauseFollowing,          // (ms) => void
  speak,                   // (text) => Promise|void
  getRoute,
  decodePolyline,
  getTurnByTurnSteps,
  setSteps,                // (steps[]) => void
  onRouteReset,            // () => void  (ekrandaki spokenFlags, snap, follow vb. sıfırlansın)
}) {
  const [routes, setRoutes] = useState([]);
  const [dynamicRouteCoords, setDynamicRouteCoords] = useState([]);
  const [pendingRouteMeta, setPendingRouteMeta] = useState(null);
  const [isRerouting, setIsRerouting] = useState(false);

  const routePairIdRef = useRef(0);

  const routeCoordinates = dynamicRouteCoords.length
    ? dynamicRouteCoords
    : baseRouteCoordinates;

  const primaryRoute = useMemo(() => {
    if (!routes?.length) return null;
    return [...routes].sort((a, b) => (a.duration ?? 1e12) - (b.duration ?? 1e12))[0];
  }, [routes]);

  const distKm = primaryRoute?.distance ? (primaryRoute.distance / 1000).toFixed(1) : null;
  const durMin = primaryRoute?.duration ? Math.round(primaryRoute.duration / 60) : null;

  const toLL = (p) => {
    if (!p) return null;
    const lat = p.latitude ?? p.lat;
    const lng = p.longitude ?? p.lng;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  };

  const coordsFromSteps = useCallback((arr) => {
    const out = [];
    if (!Array.isArray(arr)) return out;
    for (const s of arr) {
      let seg = null;
      if (s?.geometry?.type === 'LineString' && Array.isArray(s.geometry.coordinates)) {
        seg = s.geometry.coordinates; // [[lng,lat], ...]
      } else if (Array.isArray(s?.geometry)) {
        seg = s.geometry; // [[lng,lat], ...]
      } else {
        const pl = s?.polyline?.points || s?.polyline;
        if (pl) {
          try {
            const pts = decodePolyline(pl).map((p) => [p.longitude ?? p.lng, p.latitude ?? p.lat]);
            seg = pts;
          } catch {}
        }
      }
      if (Array.isArray(seg) && seg.length) {
        if (out.length && out[out.length - 1][0] === seg[0][0] && out[out.length - 1][1] === seg[0][1]) {
          out.push(...seg.slice(1));
        } else {
          out.push(...seg);
        }
      }
    }
    return out;
  }, [decodePolyline]);

  const beginRouteUpdate = useCallback((coords, meta = null) => {
    const id = ++routePairIdRef.current;
    setDynamicRouteCoords(Array.isArray(coords) ? coords : []);
    setPendingRouteMeta(meta ?? null);

    // ekran tarafındaki transient durumları resetle
    onRouteReset?.();

    return id;
  }, [onRouteReset]);

  const finalizeRouteSteps = useCallback((id, stepsArr, fallbackSteps = []) => {
    if (id !== routePairIdRef.current) return;
    const finalSteps = Array.isArray(stepsArr) && stepsArr.length ? stepsArr : fallbackSteps;
    const stitched = coordsFromSteps(finalSteps);
    if (stitched.length >= 2) setDynamicRouteCoords(stitched);
    setSteps?.(finalSteps);
    setPendingRouteMeta(null);
  }, [coordsFromSteps, setSteps]);

  const fetchRoute = useCallback(async () => {
    if (!from || !to) return;

    const wp = Array.isArray(waypointsRef?.current) ? waypointsRef.current : [];
    // 🔧 VIA ile tek tip: sağlayıcı waypoints'i "via" olarak yorumlasın
    const wpForApi = wp.map((w) => ({ lat: w.lat, lng: w.lng, via: true }));

    const res = await getRoute(toLL(from), toLL(to), mode, {
      waypoints: wpForApi,
      optimize: wpForApi.length ? false : true,
      alternatives: true,
    });

    setRoutes(res || []);

    const best = res?.[0];
    const decoded = best?.decodedCoords || [];
    if (decoded.length && cameraRef?.current?.fitBounds) {
      // POI araması / durak ekleme açıkken otomatik fit yapma
      if (!poiActiveRef?.current?.type && !poiActiveRef?.current?.query && !addStopOpenRef?.current) {
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        decoded.forEach((c) => {
          if (c.latitude < minLat) minLat = c.latitude;
          if (c.latitude > maxLat) maxLat = c.latitude;
          if (c.longitude < minLng) minLng = c.longitude;
          if (c.longitude > maxLng) maxLng = c.longitude;
        });
        pauseFollowing?.(1200);
        cameraRef.current.fitBounds([maxLng, maxLat], [minLng, minLat], 50, 500);
      }
    }
  }, [from, to, mode, waypointsRef, cameraRef, poiActiveRef, addStopOpenRef, pauseFollowing, getRoute]);

  const recalcRoute = useCallback(
    async ({ originLat, originLng, keepSpeak = true, waypointsOverride } = {}) => {
      if (!to) return;

      const origin =
        originLat != null && originLng != null
          ? { latitude: originLat, longitude: originLng }
          : from
          ? { latitude: from.latitude ?? from.lat, longitude: from.longitude ?? from.lng }
          : null;

      if (!origin) return;

      try {
        setIsRerouting(true);
        if (keepSpeak) await speak?.('Rota yeniden hesaplanıyor.');

        const wp = Array.isArray(waypointsOverride) ? waypointsOverride : (waypointsRef?.current ?? []);
        const opts = { alternatives: false, optimize: wp.length ? false : true };
        if (wp.length) opts.waypoints = wp.map((w) => ({ lat: w.lat, lng: w.lng, via: true }));

        const routesRes = await getRoute(toLL(origin), toLL(to), mode || 'driving', opts);
        const primary = Array.isArray(routesRes) ? routesRes[0] : routesRes;
        if (!primary?.polyline && !primary?.geometry) throw new Error('Yeni rota alınamadı');

        let coords = [];
        if (primary?.geometry?.type === 'LineString' && Array.isArray(primary.geometry.coordinates)) {
          coords = primary.geometry.coordinates; // [[lng,lat], ...]
        } else if (primary?.polyline) {
          const decoded = decodePolyline(primary.polyline);
          coords = decoded.map((c) => [c.longitude, c.latitude]);
        }

        const meta = {
          dist: typeof primary.distance === 'number' ? primary.distance : null,
          sec: typeof primary.duration === 'number' ? primary.duration : null,
        };

        const rpId = beginRouteUpdate(coords, meta);

        let providerSteps = Array.isArray(primary.steps) ? primary.steps : [];
        if (!providerSteps.length) {
          const stepOrigin = { lat: origin.latitude, lng: origin.longitude };
          providerSteps = await getTurnByTurnSteps(stepOrigin, toLL(to));
        }

        finalizeRouteSteps(rpId, providerSteps);
      } catch {
        await speak?.('Rota alınamadı.');
      } finally {
        setIsRerouting(false);
      }
    },
    [from, to, mode, speak, waypointsRef, getRoute, decodePolyline, getTurnByTurnSteps, beginRouteUpdate, finalizeRouteSteps]
  );

  return {
    routes,
    primaryRoute,
    distKm,
    durMin,
    isRerouting,
    pendingRouteMeta,
    routeCoordinates,
    setRoutes,                 // isteğe bağlı kullanım
    setDynamicRouteCoords,     // isteğe bağlı kullanım
    setPendingRouteMeta,       // isteğe bağlı kullanım
    fetchRoute,
    recalcRoute,
    beginRouteUpdate,
    finalizeRouteSteps,
  };
}
