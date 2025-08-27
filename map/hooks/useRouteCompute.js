// hooks/useRouteCompute.js
import { useCallback, useRef } from 'react';
import { decodePolyline } from '../maps'; // maps içinden geliyor
import { getRoute } from '../maps';
import { meters, makeRequestKeyStrict  } from '../utils/geo';
import { useRouteCache } from './useRouteCache';



// ---- küçük yardımcılar (MapScreen’den taşındı) ----

const toStrictLL = (c) => {
  const lat = c?.lat ?? c?.latitude;
  const lng = c?.lng ?? c?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const nearlySame = (a, b, m = 5) => {
  if (!a || !b) return false;
  try { return meters(a, b) <= m; } catch { return false; }
};

const dedupWaypoints = (wps, fromLL, toLL_) => {
  const out = [];
  for (const w of wps) {
    const lat = w?.lat ?? w?.latitude ?? w?.coords?.latitude ?? w?.location?.lat;
    const lng = w?.lng ?? w?.longitude ?? w?.coords?.longitude ?? w?.location?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const ll = { lat, lng, place_id: w.place_id ?? w.id ?? null };
    if (fromLL && nearlySame(ll, fromLL)) continue;
    if (toLL_ && nearlySame(ll, toLL_)) continue;
    if (out.some(prev => nearlySame(prev, ll))) continue;
    out.push(ll);
  }
  return out;
};

const approxRouteCoversWaypoints = (decodedCoords, wpsLL, tolMeters = 120) => {
  if (!Array.isArray(decodedCoords) || decodedCoords.length === 0) return false;
  const pts = decodedCoords
    .map(p => {
      const lat = p.latitude ?? p.lat;
      const lng = p.longitude ?? p.lng;
      return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
    })
    .filter(Boolean);

  const nearestIdx = (w) => {
    let bestI = -1, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      try {
        const d = meters(pts[i], w);
        if (d < bestD) { bestD = d; bestI = i; }
      } catch {}
    }
    return { i: bestI, d: bestD };
  };

  const hits = wpsLL.map(nearestIdx);
  const covers = hits.every(h => Number.isFinite(h.d) && h.d <= tolMeters);
  if (!covers) return false;
  for (let k = 1; k < hits.length; k++) {
    if (!(hits[k - 1].i < hits[k].i)) return false;
  }
  return true;
};

const stitchSegments = (segments) => {
  const all = [];
  for (let i = 0; i < segments.length; i++) {
    const part = segments[i];
    if (!Array.isArray(part) || part.length === 0) continue;
    if (i > 0 && all.length) {
      const first = part[0], last = all[all.length - 1];
      const fLat = first.latitude ?? first.lat;
      const fLng = first.longitude ?? first.lng;
      const lLat = last.latitude ?? last.lat;
      const lLng = last.longitude ?? last.lng;
      if (Math.abs(fLat - lLat) < 1e-6 && Math.abs(fLng - lLng) < 1e-6) {
        part.shift();
      }
    }
    all.push(...part);
  }
  return all;
};

const recHashNum = (v) => (Number.isFinite(v) ? v.toFixed(6) : 'x');
const recHashPoint = (p) => p ? `${recHashNum(p.lat ?? p.latitude)},${recHashNum(p.lng ?? p.longitude)}` : 'x,x';
const makeRequestKey = (mode, fromLL, toLL_, wpsArr) => {
  const wpsSig = (Array.isArray(wpsArr) ? wpsArr : [])
    .map(w => `${recHashPoint(w)}#${w.place_id || ''}`)
    .join('|');
  return `m:${mode}|f:${recHashPoint(fromLL)}|t:${recHashPoint(toLL_)}|w:${wpsSig}`;
};

// ---- asıl hook ----
export function useRouteCompute({ map, mapRef, normalizeCoord, presentRouteSheet }) {
  const routeCache = useRouteCache();
  const routeCalcSeqRef = useRef({});   // { driving: n, walking: n, transit: n }
  const routeActiveKeyRef = useRef({}); // { driving: key, ... }

  // useRouteCompute.js içinde, useRouteCompute fonksiyonunun içinde:
    const fetchRouteOnce = async (fromLL, toLL, selMode, opts, keyPart) => {
    const key = `r:${selMode}|${keyPart}|opt:${JSON.stringify({
        w: opts?.waypoints || opts?.waypointsLL || null,
        alt: !!opts?.alternatives,
        opt: !!opts?.optimize,
    })}`;

    const { data } = await routeCache.getOrFetch(key, async () => {
     const key = `r:${mode}|${keyPart}|opt:${JSON.stringify({
       w: opts?.waypoints || opts?.waypointsLL || null,
       alt: !!opts?.alternatives,
       opt: !!opts?.optimize
     })}`;
     const { data } = await routeCache.getOrFetch(key, async () => {
     const keyPart = makeRequestKeyStrict(selMode, fromLL, toLL_, cleanLL);
     const list = await fetchRouteOnce(fromLL, toLL_, selMode, opts, keyPart);
       return list;
     });
     return data || [];
    });

    return data || [];
    };

  const buildSegmentedRoute = useCallback(
    async (fromLL, toLL_, cleanLL, selMode) => {
      try {
        const nodes = [fromLL, ...cleanLL, toLL_];
        const segments = [];
        let totalDist = 0;
        let totalDur = 0;

        for (let i = 0; i < nodes.length - 1; i++) {
          const a = nodes[i], b = nodes[i + 1];
          const raw = await getRoute(a, b, selMode, { optimize: false, alternatives: false, __seg: i });
          const seg = Array.isArray(raw) ? raw[0] : raw;
          const dec = seg?.decodedCoords || decodePolyline(seg?.polyline || '');
          if (!dec || !dec.length) {
            console.warn('[route:fallback] segment failed (no polyline)', i);
            return null;
          }
          segments.push(dec);
          totalDist += seg?.distance || 0;
          totalDur  += seg?.duration || 0;
        }

        const mergedCoords = stitchSegments(segments);
        return {
          id: `${selMode}-segmented`,
          isPrimary: true,
          decodedCoords: mergedCoords,
          distance: totalDist,
          duration: totalDur,
          mode: selMode,
        };
      } catch (e) {
        console.warn('[route:fallback] error', e?.message || e);
        return null;
      }
    },
    []
  );

  const recalcRoute = useCallback(
    async (selMode = map.selectedMode, waypointsOverride = null, fromOverride = null, toOverride = null) => {
      const modeKey = selMode || 'driving';
      routeCalcSeqRef.current[modeKey] = (routeCalcSeqRef.current[modeKey] || 0) + 1;
      const mySeq = routeCalcSeqRef.current[modeKey];

      const fromC0 = normalizeCoord(fromOverride ?? map.fromLocation?.coords);
      const toC0   = normalizeCoord(toOverride  ?? map.toLocation?.coords);
      const fromLL = toStrictLL(fromC0);
      const toLL_  = toStrictLL(toC0);
      if (!fromLL || !toLL_) return;

      const srcWps = Array.isArray(waypointsOverride) ? waypointsOverride : map.waypoints;

      const wpIdsRaw = (Array.isArray(srcWps) ? srcWps : [])
        .map(w => w?.place_id || w?.id)
        .filter(Boolean);

      const wpsLL_raw = (Array.isArray(srcWps) ? srcWps : []).map(w => ({
        lat: w?.lat ?? w?.latitude ?? w?.coords?.latitude ?? w?.location?.lat,
        lng: w?.lng ?? w?.longitude ?? w?.coords?.longitude ?? w?.location?.lng,
        place_id: w?.place_id || w?.id || null,
      })).filter(w => Number.isFinite(w.lat) && Number.isFinite(w.lng));

      const cleanLL = dedupWaypoints(wpsLL_raw, fromLL, toLL_);

      const reqKey = makeRequestKey(selMode, fromLL, toLL_, [
        ...cleanLL.map(w => ({ latitude: w.lat, longitude: w.lng, place_id: w.place_id })),
        ...wpIdsRaw
          .filter(pid => !cleanLL.some(w => w.place_id === pid))
          .map(pid => ({ latitude: NaN, longitude: NaN, place_id: pid })),
      ]);
      routeActiveKeyRef.current[modeKey] = reqKey;

      const wpPlaceId      = Array.from(new Set(wpIdsRaw)).map(pid => `via:place_id:${pid}`);
      const wpViaLatLng    = cleanLL.map(w => `via:${w.lat.toFixed(6)},${w.lng.toFixed(6)}`);
      const wpLLForSegment = cleanLL.map(w => ({ lat: w.lat, lng: w.lng }));
      const baseOpts = { optimize: false, alternatives: cleanLL.length === 0 };

      const attempts = [
        { ...baseOpts, __attempt: 'no-wp' }, // base route (her durumda)
        wpPlaceId.length      ? { ...baseOpts, waypoints: wpPlaceId,           __attempt: 'via:place_id' } : null,
        wpViaLatLng.length    ? { ...baseOpts, waypoints: wpViaLatLng,         __attempt: 'via:latlng'   } : null,
        wpLLForSegment.length ? { ...baseOpts, waypointsLL: wpLLForSegment,     __attempt: 'LL-array'     } : null,
      ].filter(Boolean);

      let routes = null;

      const normalizeList = (raw, attemptTag) => {
        return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((r, i) => ({
          ...r,
          decodedCoords: r.decodedCoords || decodePolyline(r.polyline || ''),
          isPrimary: i === 0,
          id: `${selMode}-${attemptTag}-${i}`,
          mode: selMode,
        }));
      };

      for (const opts of attempts) {
        try {
          const raw  = await getRoute(fromLL, toLL_, selMode, { ...opts, __debug: true });
          let list   = normalizeList(raw, opts.__attempt);
          const ok   = list.length && list[0].decodedCoords?.length > 0;
          if (!ok) continue;

          if (cleanLL.length > 0) {
            const covers = approxRouteCoversWaypoints(list[0].decodedCoords, cleanLL);
            if (!covers) {
              if (opts.__attempt !== 'via:latlng' && wpViaLatLng.length) {
                try {
                  const raw2  = await getRoute(fromLL, toLL_, selMode, { ...baseOpts, waypoints: wpViaLatLng, __attempt: 'via:latlng:forced' });
                  const list2 = normalizeList(raw2, 'via:latlng:forced');
                  const ok2   = list2.length && list2[0].decodedCoords?.length > 0;
                  const cov2  = ok2 && approxRouteCoversWaypoints(list2[0].decodedCoords, cleanLL);
                  if (ok2 && cov2) {
                    list = list2;
                  } else {
                    const merged = await buildSegmentedRoute(fromLL, toLL_, cleanLL, selMode);
                    if (merged) { merged.isPrimary = true; routes = [merged]; break; }
                    else { continue; }
                  }
                } catch {
                  const merged = await buildSegmentedRoute(fromLL, toLL_, cleanLL, selMode);
                  if (merged) { merged.isPrimary = true; routes = [merged]; break; }
                  else { continue; }
                }
              } else {
                const merged = await buildSegmentedRoute(fromLL, toLL_, cleanLL, selMode);
                if (merged) { merged.isPrimary = true; routes = [merged]; break; }
                else { continue; }
              }
            }
          }

          routes = list;
          break;
        } catch (e) {
          console.warn('getRoute attempt failed', opts.__attempt, e?.message || e);
        }
      }

      if (!routes && cleanLL.length) {
        const merged = await buildSegmentedRoute(fromLL, toLL_, cleanLL, selMode);
        if (merged) routes = [merged];
      }

      const stale =
        mySeq !== routeCalcSeqRef.current[modeKey] ||
        reqKey !== routeActiveKeyRef.current[modeKey];

      if (!routes) {
        if (stale) return;
        const hadPrev = Array.isArray(map.routeOptions?.[selMode]) && map.routeOptions[selMode].length > 0;
        if (hadPrev) return;
        map.setRouteOptions(prev => ({ ...prev, [selMode]: [] }));
        return;
      }

      if (stale) return;

      map.setRouteOptions(prev => ({ ...prev, [selMode]: routes }));

      const primary = routes.find(r => r.isPrimary) || routes[0];
      if (primary?.decodedCoords?.length) {
        mapRef.current?.fitToCoordinates(primary.decodedCoords, {
          edgePadding: { top: 50, right: 50, bottom: 200, left: 50 },
          animated: true,
        });
        // MapScreen dışında sheet kontrolünü tetikleyebilmek için callback alıyoruz
        presentRouteSheet?.();
      }
    },
    [map, mapRef, presentRouteSheet, normalizeCoord]
  );

  const prefetchMissingModes = useCallback(async (fNorm, tNorm) => {
    const f = fNorm, t = tNorm;
    if (!f || !t) return;
    for (const m of ['driving', 'walking', 'transit']) {
      const hasData = Array.isArray(map.routeOptions?.[m]) && map.routeOptions[m].length > 0;
      if (!hasData) {
             const keyPart = makeRequestKeyStrict(m, {lat:f.latitude,lng:f.longitude},{lat:t.latitude,lng:t.longitude}, []);
        await fetchRouteOnce(f, t, m, { optimize:false, alternatives:true }, keyPart).catch(()=>{});
        try { await recalcRoute(m, null, f, t); } catch {}
      }
    }
  }, [map.routeOptions, recalcRoute]);

  return { recalcRoute, prefetchMissingModes };
}
