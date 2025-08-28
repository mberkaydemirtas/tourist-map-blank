// src/navigation/hooks/useWaypointsManager.js
import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Waypoint durum yönetimi + yer çözümleme (place -> {lat,lng,name,...})
 * Ekran tarafında durak ekleme/düzenleme overlay akışı kalabilir;
 * bu hook kalıcı waypoint listesini ve yardımcıları sağlar.
 */
export default function useWaypointsManager({ initialWaypoints = [], getPlaceDetails }) {
  const normalizeWp = useCallback((w) => {
    if (!w) return null;
    const lat = w.lat ?? w?.coords?.latitude ?? w?.latitude;
    const lng = w.lng ?? w?.coords?.longitude ?? w?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat, lng,
      name: w.name || w.description || '',
      address: w.address || w.vicinity || '',
      place_id: w.place_id || w.id || null,
    };
  }, []);

  const [waypoints, setWaypoints] = useState(
    Array.isArray(initialWaypoints) ? initialWaypoints.map(normalizeWp).filter(Boolean) : []
  );

  const waypointsRef = useRef(waypoints);
  useEffect(() => { waypointsRef.current = waypoints; }, [waypoints]);

  const resolvePlace = useCallback(async (place) => {
    try {
      const pid = place?.place_id || place?.id;

      let lat = place?.geometry?.location?.lat
        ?? place?.location?.lat
        ?? place?.coords?.latitude
        ?? place?.lat;

      let lng = place?.geometry?.location?.lng
        ?? place?.location?.lng
        ?? place?.coords?.longitude
        ?? place?.lng;

      let name = place?.name || place?.structured_formatting?.main_text || place?.description || 'Seçilen yer';
      let address = place?.vicinity || place?.formatted_address || place?.secondary_text || place?.description || '';

      if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && pid && typeof getPlaceDetails === 'function') {
        const d = await getPlaceDetails(pid);
        lat = d?.geometry?.location?.lat ?? lat;
        lng = d?.geometry?.location?.lng ?? lng;
        name = d?.name || name;
        address = d?.formatted_address || d?.vicinity || address;
      }

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      return { lat, lng, name, place_id: pid ?? null, address };
    } catch {
      return null;
    }
  }, [getPlaceDetails]);

  return {
    waypoints,
    setWaypoints,
    waypointsRef,
    normalizeWp,
    resolvePlace,
  };
}
