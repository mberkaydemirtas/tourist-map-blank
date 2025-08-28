// src/navigation/useAltRoutes.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Alternatif rotalar için hook.
 * - Alternatifleri fetch/parsing
 * - Aç/Kapat kontrolü
 * - Bir alternatifin uygulanması (beginRouteUpdate + finalizeRouteSteps)
 *
 * Beklenen parametreler:
 * {
 *   from: {latitude, longitude},
 *   to: {latitude, longitude},
 *   waypointsRef: React.MutableRefObject<Array<{lat:number,lng:number}>>,
 *   routeCoordsRef: React.MutableRefObject<Array<[number,number]>>,
 *   lastLocRef: React.MutableRefObject<{latitude:number, longitude:number} | null>,
 *   getRoute, decodePolyline, getTurnByTurnSteps,
 *   effSec: number | null,           // mevcut rotanın süresi (s)
 *   isAddingStop: boolean,           // POI/durak eklemede iken kapat
 *   beginRouteUpdate: (coords:[number,number][], meta?:{sec?:number, dist?:number}) => number,
 *   finalizeRouteSteps: (id:number, steps:any[], fallbackSteps?:any[]) => void,
 *   safeSpeak?: (text:string) => void
 * }
 */
export default function useAltRoutes({
  from,
  to,
  waypointsRef,
  routeCoordsRef,
  lastLocRef,
  getRoute,
  decodePolyline,
  getTurnByTurnSteps,
  effSec,
  isAddingStop,
  beginRouteUpdate,
  finalizeRouteSteps,
  safeSpeak,
}) {
  const [altMode, setAltMode] = useState(false);
  const [altFetching, setAltFetching] = useState(false);
  const [altRoutes, setAltRoutes] = useState([]);

  // basit yardımcılar
  const toLL = useCallback((p) => {
    if (!p) return null;
    const lat = p.latitude ?? p.lat;
    const lng = p.longitude ?? p.lng;
    return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
  }, []);

  const parseRoutes = useCallback((routesRaw) => {
    const list = Array.isArray(routesRaw)
      ? routesRaw
      : routesRaw?.routes || routesRaw?.alternatives || (routesRaw ? [routesRaw] : []);

    return list
      .map((r, i) => {
        let coords = [];
        if (r.geometry && r.geometry.type === 'LineString' && Array.isArray(r.geometry.coordinates)) {
          coords = r.geometry.coordinates;
        } else {
          const poly =
            r.polyline ||
            (typeof r.overview_polyline === 'string'
              ? r.overview_polyline
              : r.overview_polyline?.points) ||
            r.routePolyline ||
            null;
          if (poly) {
            const dec = decodePolyline(poly);
            coords = dec.map((c) => [c.longitude, c.latitude]); // [lng,lat]
          }
        }

        // distance
        let dist = null;
        if (typeof r.distance === 'number') dist = r.distance;
        else if (typeof r.distance?.value === 'number') dist = r.distance.value;
        else if (Array.isArray(r.legs)) dist = r.legs.reduce((s, l) => s + (l?.distance?.value || 0), 0);

        // duration
        let dur = null;
        if (typeof r.duration === 'number') dur = r.duration;
        else if (typeof r.duration?.value === 'number') dur = r.duration.value;
        else if (Array.isArray(r.legs)) dur = r.legs.reduce((s, l) => s + (l?.duration?.value || 0), 0);

        return {
          id: r.id || String(i),
          coords,
          distance: dist,
          duration: dur,
          steps: r.steps || (r.legs ? r.legs.flatMap((x) => x.steps || []) : []),
          summary: r.summary || r.name || `Rota ${i + 1}`,
        };
      })
      .filter((x) => Array.isArray(x.coords) && x.coords.length >= 2);
  }, [decodePolyline]);

  const loadAlternatives = useCallback(async () => {
    setAltFetching(true);
    try {
      const origin = lastLocRef.current
        ? { latitude: lastLocRef.current.latitude, longitude: lastLocRef.current.longitude }
        : { latitude: from?.latitude, longitude: from?.longitude };

      const opts = { alternatives: true };
      const wps = Array.isArray(waypointsRef?.current) ? waypointsRef.current : [];
      if (wps.length) {
        opts.waypoints = wps.map(w => ({ lat: w.lat, lng: w.lng, via: true }));
        opts.optimize = false;
      }

      const raw = await getRoute(toLL(origin), toLL(to), 'driving', opts);
      let parsed = parseRoutes(raw);

      // mevcut polyline ile çok benzer olanları filtrele (gereksiz kalabalık)
      const curLen = routeCoordsRef?.current?.length || 0;
      parsed = parsed.filter((r) => Math.abs(r.coords.length - curLen) > 2);

      setAltRoutes(parsed);
    } catch (e) {
      setAltRoutes([]);
    } finally {
      setAltFetching(false);
    }
  }, [from, to, getRoute, parseRoutes, toLL, waypointsRef, routeCoordsRef, lastLocRef]);

  const toggleAlternatives = useCallback(() => {
    if (isAddingStop) return; // ekleme modunda kilit
    setAltMode((prev) => {
      const next = !prev;
      if (next) {
        setAltRoutes([]);
        loadAlternatives();
      } else {
        setAltRoutes([]);
      }
      return next;
    });
  }, [isAddingStop, loadAlternatives]);

  const applyAlternative = useCallback(async (r) => {
    // meta + mavi hattı güncelle
    const meta = { sec: r.duration ?? null, dist: r.distance ?? null };
    const rpId = beginRouteUpdate(r.coords, meta);

    // adımlar (yoksa provider'dan iste)
    if (Array.isArray(r.steps) && r.steps.length) {
      finalizeRouteSteps(rpId, r.steps);
    } else {
      const origin = lastLocRef.current
        ? { lat: lastLocRef.current.latitude, lng: lastLocRef.current.longitude }
        : { lat: from.latitude, lng: from.longitude };

      try {
        const mSteps = await getTurnByTurnSteps(origin, toLL(to));
        finalizeRouteSteps(rpId, mSteps);
      } catch {
        finalizeRouteSteps(rpId, []);
      }
    }

    // sesli bildirim
    const baseS = effSec ?? null;
    const cmpText = (() => {
      if (!Number.isFinite(baseS) || !Number.isFinite(r.duration)) return '';
      const diff = Math.round(r.duration - baseS);
      const ad = Math.abs(diff);
      if (ad < 45) return 'aynı süre';
      const mins = Math.max(1, Math.round(ad / 60));
      return diff < 0 ? `${mins} dk daha hızlı` : `${mins} dk daha yavaş`;
    })();
    if (cmpText && typeof safeSpeak === 'function') {
      safeSpeak(`Alternatif rota seçildi, ${cmpText}.`);
    }

    // UI kapat
    setAltMode(false);
    setAltRoutes([]);
  }, [
    beginRouteUpdate,
    finalizeRouteSteps,
    lastLocRef,
    from,
    to,
    getTurnByTurnSteps,
    toLL,
    effSec,
    safeSpeak,
  ]);

  // Durak ekleme başlayınca alternatifleri kapat
  useEffect(() => {
    if (isAddingStop && altMode) {
      setAltMode(false);
      setAltRoutes([]);
    }
  }, [isAddingStop, altMode]);

  // Memo: dışarı vereceğimiz yapı
  const api = useMemo(() => ({
    altMode,
    altFetching,
    altRoutes,
    toggleAlternatives,
    applyAlternative,
  }), [altMode, altFetching, altRoutes, toggleAlternatives, applyAlternative]);

  return api;
}
