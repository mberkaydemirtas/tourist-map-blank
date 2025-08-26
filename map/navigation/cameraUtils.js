// src/navigation/cameraUtils.js
/**
 * Map kamerasını verilen lng/lat noktasına taşır.
 * pauseFollowing: (ms) — ekrandaki takip modunu kısa süre durdurmak için.
 */
export function focusOn(cameraRef, pauseFollowing, lng, lat, zoom = 18, animMs = 450) {
  if (!cameraRef?.current) return;
  try {
    pauseFollowing?.(8000);
    cameraRef.current.setCamera?.({
      centerCoordinate: [lng, lat],
      zoom,
      animationDuration: animMs,
    });
  } catch {}
}

/**
 * Tüm rota koordinatlarına fit olur (bounds).
 * coords: [ [lng,lat], ... ]
 */
export function fitBoundsToCoords(cameraRef, pauseFollowing, coords, pad = 50, animMs = 500) {
  if (!cameraRef?.current || !Array.isArray(coords) || coords.length < 2) return;
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const [lng, lat] of coords) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  pauseFollowing?.(1200);
  try {
    cameraRef.current.fitBounds?.([maxLng, maxLat], [minLng, minLat], pad, animMs);
  } catch {}
}
