// src/navigation/hooks/useSnapToRoute.js
import { useEffect, useState } from 'react';
import { closestPointOnPolyline } from '../navMath';

// Basit haversine (metre)
const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const distMeters = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa = Math.sin(dLat / 2) ** 2 +
             Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
};

/**
 * Rota polylinena en yakın noktayı bulup, yakınsa (<= maxSnapM) “snap ghost” döndürür.
 * routeCoordinates: Array<[lng, lat]>
 * location: { latitude, longitude }
 */
export default function useSnapToRoute({
  routeCoordinates = [],
  location = null,
  isFollowing = true,
  maxSnapM = 20,
}) {
  const [snapCoord, setSnapCoord] = useState(null);

  useEffect(() => {
    if (!isFollowing || !location || !Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
      setSnapCoord(null);
      return;
    }
    try {
      const p = { lng: location.longitude, lat: location.latitude };
      const res = closestPointOnPolyline(routeCoordinates, [p.lng, p.lat]);
      // Esnek dönüş şekilleri için toleranslı çözüm
      let point = null;
      let distanceM = null;

      if (res && Array.isArray(res.point)) {
        point = res.point;                       // [lng,lat]
        distanceM = res.distanceM ?? res.distance ?? null;
      } else if (Array.isArray(res) && res.length >= 2) {
        point = res;                              // [lng,lat]
      }

      if (point && (distanceM == null)) {
        distanceM = distMeters(p, { lng: point[0], lat: point[1] });
      }

      if (point && typeof distanceM === 'number' && distanceM <= maxSnapM) {
        setSnapCoord({ lat: point[1], lng: point[0] });
      } else {
        setSnapCoord(null);
      }
    } catch {
      setSnapCoord(null);
    }
  }, [routeCoordinates, location?.latitude, location?.longitude, isFollowing, maxSnapM]);

  return { snapCoord };
}
