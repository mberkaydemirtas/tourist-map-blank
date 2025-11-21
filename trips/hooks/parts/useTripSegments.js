// trips/hooks/parts/useTripSegments.js
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { InteractionManager } from 'react-native';
import Constants from 'expo-constants';

import { getRouteDirections } from '../../services/RouteDirectionService';
import { round5k } from '../../components/TripPlanHelpers';

const DIRECTIONS_API_KEY =
  Constants?.expoConfig?.extra?.GOOGLE_MAPS_API_KEY ||
  Constants?.manifest?.extra?.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  global?.GOOGLE_MAPS_API_KEY ||
  '';

/**
 * Bir activity’den Google Directions waypoint objesi üretir.
 *  - Eğer place_id varsa place-mode
 *  - Yoksa lat/lng ile koor kullanır
 */
export function buildWaypointFromAct(act) {
  const pid = act?.place?.place_id || act?.meta?.place_id || act?.gPlaceId;
  const loc = act?.place?.location;
  if (pid && typeof pid === 'string') return { place_id: pid };
  if (loc?.lat != null && (loc?.lon != null || loc?.lng != null)) {
    return { lat: Number(loc.lat), lng: Number(loc.lon ?? loc.lng) };
  }
  return null;
}

/**
 * Gün içi segmentleri (polyline’ları) ve
 * haritayı güne göre fit etme fonksiyonunu yönetir.
 */
export function useTripSegments({ day, uiActivities, mapRef }) {
  const [segments, setSegments] = useState([]);
  const segComputeTimerRef = useRef(null);
  const segRunIdRef = useRef(0);

  // UI aktivitelerdeki konumların imzası (değişince segmentleri yeniden hesaplıyoruz)
  const locSig = useMemo(
    () =>
      (uiActivities || [])
        .map((a) => {
          const l = a?.place?.location;
          return l ? `${round5k(l.lat)}:${round5k(l.lon)}` : 'x';
        })
        .join('|'),
    [uiActivities]
  );

  // Gün polylinesi → fitToCoordinates için hazırlanmış koordinatlar
  const polylineCoords = useMemo(() => {
    const poly = day?.route?.polyline;
    if (!poly || !poly.length) return null;
    return poly.map((p) => ({ latitude: p.lat, longitude: p.lon }));
  }, [day?.route?.polyline]);

  const fitToCoords = useCallback(
    (coords) => {
      if (!mapRef?.current || !coords || !coords.length) return;
      try {
        mapRef.current.fitToCoordinates(coords, {
          edgePadding: { top: 80, right: 80, bottom: 160, left: 80 },
          animated: true,
        });
      } catch {
        // noop
      }
    },
    [mapRef]
  );

  /**
   * Gün için haritayı uygun bir bounding box’a yakınlaştırır.
   *  - Eğer polyline varsa onu kullanır
   *  - Yoksa aktivitelerin konumlarını kullanır
   */
  const fitMapToDay = useCallback(() => {
    const acts = uiActivities || [];
    const coords =
      polylineCoords?.length
        ? polylineCoords
        : acts
            .map((a) => {
              const l = a?.place?.location;
              return l ? { latitude: l.lat, longitude: l.lon } : null;
            })
            .filter(Boolean);

    if (coords && coords.length >= 1) {
      requestAnimationFrame(() => fitToCoords(coords));
    }
  }, [polylineCoords, uiActivities, fitToCoords]);

  /**
   * Gün içi ardışık aktiviteler arasındaki segmentleri (polyline) hesaplar.
   * Google Directions üzerinden gidip her iki nokta arasını ayrı ayrı çekiyoruz.
   */
  const computeDaySegments = useCallback(async () => {
    const acts = uiActivities || [];
    if (!acts.length || !DIRECTIONS_API_KEY) {
      setSegments([]);
      return;
    }

    const myRun = ++segRunIdRef.current;

    // UI animasyonları bittikten sonra çalıştır (jank azaltmak için)
    await new Promise((r) => InteractionManager.runAfterInteractions(r));
    await new Promise((r) => setTimeout(r, 16));

    const jobs = [];
    for (let i = 0; i < acts.length - 1; i++) {
      const a = acts[i];
      const b = acts[i + 1];
      const la = a?.place?.location;
      const lb = b?.place?.location;
      if (!la || !lb) continue;

      const w1 = buildWaypointFromAct(a);
      const w2 = buildWaypointFromAct(b);

      jobs.push(async () => {
        try {
          const d =
            w1 && w2
              ? await getRouteDirections({
                  waypoints: [w1, w2],
                  mode: 'driving',
                  apiKey: DIRECTIONS_API_KEY,
                })
              : null;

          const coords = (d?.polylineCoords || []).map((c) => ({
            latitude: c.latitude,
            longitude: c.longitude,
          }));

          if (coords?.length >= 2) {
            return { ok: true, coords };
          }

          // Fallback: düz çizgi
          return {
            ok: false,
            coords: [
              { latitude: la.lat, longitude: la.lon },
              { latitude: lb.lat, longitude: lb.lon },
            ],
          };
        } catch (e) {
          // Hata da olsa düz çizgi çiz
          return {
            ok: false,
            coords: [
              { latitude: la.lat, longitude: la.lon },
              { latitude: lb.lat, longitude: lb.lon },
            ],
          };
        }
      });
    }

    const runPool = async (tasks) => {
      const CONCURRENCY = 6;
      if (tasks.length <= CONCURRENCY) {
        return Promise.all(tasks.map((t) => t()));
      }
      const out = new Array(tasks.length);
      let next = 0;
      const workers = new Array(CONCURRENCY).fill(0).map(async () => {
        while (true) {
          const i = next++;
          if (i >= tasks.length) return;
          out[i] = await tasks[i]();
          await new Promise((r) => setTimeout(r, 0));
        }
      });
      await Promise.all(workers);
      return out;
    };

    // Max 5 sn’de segmentleri hesapla; çok uzarsa fallback düz çizgiler
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve('__timeout__'), 5000)
    );

    const result = await Promise.race([runPool(jobs), timeout]);
    if (segRunIdRef.current !== myRun) return; // başka bir run başladıysa ignore

    if (result === '__timeout__') {
      const nextSegs = [];
      for (let i = 0; i < acts.length - 1; i++) {
        const a = acts[i];
        const b = acts[i + 1];
        const la = a?.place?.location;
        const lb = b?.place?.location;
        if (!la || !lb) continue;
        nextSegs.push({
          ok: false,
          coords: [
            { latitude: la.lat, longitude: la.lon },
            { latitude: lb.lat, longitude: lb.lon },
          ],
        });
      }
      setSegments(nextSegs);
      return;
    }

    setSegments((result || []).filter(Boolean));
  }, [uiActivities]);

  // Gün veya lokasyon imzası değişince segmentleri yeniden hesapla
  useEffect(() => {
    if (!day) {
      setSegments([]);
      return;
    }
    if (segComputeTimerRef.current) {
      clearTimeout(segComputeTimerRef.current);
    }
    segComputeTimerRef.current = setTimeout(() => {
      computeDaySegments();
    }, 60);

    return () => {
      if (segComputeTimerRef.current) {
        clearTimeout(segComputeTimerRef.current);
      }
    };
  }, [day, locSig, computeDaySegments]);

  return {
    segments,
    fitMapToDay,
  };
}
