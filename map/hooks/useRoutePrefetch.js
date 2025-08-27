// src/hooks/useRoutePrefetch.js
import { useEffect, useRef } from 'react';

/**
 * Rota moduna geçildiğinde driving/walking/transit gibi eksik modları önden çeker.
 */
export function useRoutePrefetch({ mode, map, normalizeCoord, prefetchMissingModes }) {
  const keyRef = useRef(null);

  useEffect(() => {
    if (mode !== 'route') return;
    const f = normalizeCoord(map.fromLocation?.coords);
    const t = normalizeCoord(map.toLocation?.coords);
    if (!f || !t) return;

    const key = `${f.latitude.toFixed(5)},${f.longitude.toFixed(5)}->${t.latitude.toFixed(5)},${t.longitude.toFixed(5)}`;
    if (keyRef.current === key) return;
    keyRef.current = key;

    prefetchMissingModes(f, t);
  }, [mode, map.fromLocation, map.toLocation, normalizeCoord, prefetchMissingModes]);
}
