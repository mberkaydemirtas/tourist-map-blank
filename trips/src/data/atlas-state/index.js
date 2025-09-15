
// trips/src/data/atlas-state/index.js
// atlas-state/all.json'dan hafif bir indeks üretir (state/il bazlı)

import RAW from './all.json';


// Küçük ülke listesi: [{code, name}]
export const COUNTRY_INDEX = Object.entries(RAW?.countries || {}).map(([code, c]) => ({
  code: code.toUpperCase(),
  name: c?.name || code,
}));

// (opsiyonel) dışarıdan ülke dokümanını almak istersen:
export function getCountryDoc(code) {
  const cc = String(code || '').toUpperCase();
  return RAW?.countries?.[cc] || null;
}
