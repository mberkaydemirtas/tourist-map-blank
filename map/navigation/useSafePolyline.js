// src/navigation/useSafePolyline.js
import { useMemo } from 'react';
import { toLatLng as normalizePoint } from './navMath';

/**
 * Heterojen polyline dizisini RN Maps için güvenli {latitude, longitude} dizisine çevirir.
 * - [lng,lat] / {lat,lng} / {latitude,longitude} karışık formatları destekler
 * - Ardışık aynı noktaları eler (bazı sürümlerde çizim hatası önler)
 */
export default function useSafePolyline(coords) {
  return useMemo(() => {
    const arr = (Array.isArray(coords) ? coords : [])
      .map(normalizePoint)
      .filter(p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const prev = out[out.length - 1];
      const cur = arr[i];
      if (!prev || prev.latitude !== cur.latitude || prev.longitude !== cur.longitude) {
        out.push(cur);
      }
    }
    return out;
  }, [coords]);
}
