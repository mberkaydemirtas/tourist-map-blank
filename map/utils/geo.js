// utils/geo.js
export const meters = (a, b) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371e3;
  const dφ = toRad((b.lat ?? b.latitude) - (a.lat ?? a.latitude));
  const dλ = toRad((b.lng ?? b.longitude) - (a.lng ?? a.longitude));
  const φ1 = toRad(a.lat ?? a.latitude);
  const φ2 = toRad(b.lat ?? b.latitude);
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

export const clamp = (min, max, v) => Math.min(max, Math.max(min, v));
export const toLL = (p) => ({ lat: p.lat ?? p.latitude, lng: p.lng ?? p.longitude });

export const makeRequestKeyStrict = (mode, fromLL, toLL, wpsLL=[]) => {
  const fmt = (v) => Number.isFinite(v) ? v.toFixed(6) : 'x';
  const p = (ll) => `${fmt(ll.lat)},${fmt(ll.lng)}`;
  const w = wpsLL.map(ll => `${fmt(ll.lat)},${fmt(ll.lng)}#${ll.place_id||''}`).join('|');
  return `m:${mode}|f:${p(fromLL)}|t:${p(toLL)}|w:${w}`;
};
