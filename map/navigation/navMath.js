// src/navigation/navMath.js

// ---------------------- Küçük yardımcılar ----------------------
const getLat = (p) =>
  Array.isArray(p) ? p[1] : (p?.latitude ?? p?.lat);
const getLng = (p) =>
  Array.isArray(p) ? p[0] : (p?.longitude ?? p?.lng);

export const toLatLng = (p) => {
  const lat = getLat(p);
  const lng = getLng(p);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
};

// ---------------------- Mesafe (Haversine) ----------------------
export function metersBetween(a, b) {
  const lat1 = getLat(a), lng1 = getLng(a);
  const lat2 = getLat(b), lng2 = getLng(b);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return NaN;

  const R = 6371e3;
  const toRad = (v) => (v * Math.PI) / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);

  const s = Math.sin(Δφ / 2);
  const t = Math.sin(Δλ / 2);
  const a2 = s * s + Math.cos(φ1) * Math.cos(φ2) * t * t;
  return 2 * R * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
}

// Bazı yerlerde 'haversine' adıyla çağrılıyor → alias:
export function haversine(a, b) {
  return metersBetween(a, b);
}

// ---------------------- Toplam yol uzunluğu ----------------------
/** coords: [{latitude, longitude}] / {lat,lng} / [lng,lat] karışık olabilir */
export function pathLength(coords = []) {
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = metersBetween(coords[i], coords[i + 1]);
    if (Number.isFinite(d)) sum += d;
  }
  return sum;
}

// ---------------------- Yerel düzleme projeksiyon ----------------------
const toXY = (lat, lng, lat0) => {
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return { x: lng * mPerDegLng, y: lat * mPerDegLat };
};
const fromXY = (x, y, lat0) => {
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return { latitude: y / mPerDegLat, longitude: x / mPerDegLng };
};

// ---------------------- En yakın ayak / snap ----------------------
export function pointToSegmentFoot(P, A, B, lat0) {
  const p = toXY(getLat(P), getLng(P), lat0);
  const a = toXY(getLat(A), getLng(A), lat0);
  const b = toXY(getLat(B), getLng(B), lat0);

  const ABx = b.x - a.x, ABy = b.y - a.y;
  const APx = p.x - a.x, APy = p.y - a.y;
  const ab2 = ABx * ABx + ABy * ABy || 1;
  let t = (APx * ABx + APy * ABy) / ab2;
  t = Math.max(0, Math.min(1, t));

  const cx = a.x + t * ABx, cy = a.y + t * ABy;
  const C = fromXY(cx, cy, lat0);
  const dist = Math.hypot(p.x - cx, p.y - cy);
  return { dist, point: C, t };
}

export function distanceToPolylineMeters(user, coords = []) {
  if (!coords || coords.length < 2) return Infinity;
  const lat0 = getLat(user);
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const r = pointToSegmentFoot(user, coords[i], coords[i + 1], lat0);
    if (r.dist < best) best = r.dist;
    if (best < 5) break;
  }
  return best;
}

export function closestPointOnPolyline(user, coords = []) {
  if (!coords || coords.length < 2) return { dist: Infinity, point: null, index: -1, t: 0 };
  const lat0 = getLat(user);
  let best = { dist: Infinity, point: null, index: -1, t: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const r = pointToSegmentFoot(user, coords[i], coords[i + 1], lat0);
    if (r.dist < best.dist) best = { ...r, index: i };
    if (best.dist < 5) break;
  }
  return best;
}

export function snapToPolyline(user, coords = []) {
  const r = closestPointOnPolyline(user, coords);
  return { snapped: r.point, distM: r.dist, index: r.index, t: r.t };
}
