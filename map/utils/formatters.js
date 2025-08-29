// src/utils/formatters.js
// Mesafe: metre → "850 m" / "1,2 km" / "12 km"
export function formatDistance(distanceMeters) {
  if (typeof distanceMeters !== 'number' || !isFinite(distanceMeters)) return '';
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }
  const km = distanceMeters / 1000;
  // 10 km altı: 1 ondalık, üstü tam sayı
  const formatted = km < 10 ? km.toFixed(1) : Math.round(km).toString();
  // TR locale için virgül kullanmak istersen:
  return `${formatted.replace('.', ',')} km`;
}

// Süre: saniye → "12 dk" / "1 sa 5 dk"
export function formatDuration(durationSeconds) {
  if (typeof durationSeconds !== 'number' || !isFinite(durationSeconds)) return '';
  const totalMin = Math.round(durationSeconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${totalMin} dk`;
  if (m === 0) return `${h} sa`;
  return `${h} sa ${m} dk`;
}

// Birleştirilmiş kısa özet
export function formatRouteSummary(distanceMeters, durationSeconds) {
  const d = formatDistance(distanceMeters);
  const t = formatDuration(durationSeconds);
  if (d && t) return `${d} • ${t}`;
  return d || t || '';
}
