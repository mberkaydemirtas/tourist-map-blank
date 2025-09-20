// trips/src/data/atlas/index.js
import { enableScreens } from 'react-native-screens';
// all.json boş olabilir → güvenli fallback
import RAW from './all.json';
enableScreens(false); // sadece test için. Crash kesilirse sebep screens.

// Eğer JSON boşsa, countries alanı yoksa varsayılan obje ata
const safeCountries = RAW?.countries && Object.keys(RAW.countries).length > 0
  ? RAW.countries
  : {};

export const COUNTRY_INDEX = Object.entries(safeCountries).map(([code, c]) => ({
  code,
  name: c?.name || code,
}));

export const HUBS_BY_COUNTRY = {};
for (const [code, c] of Object.entries(safeCountries)) {
  const states = Array.isArray(c?.states)
    ? c.states.slice()
    : (c?.stateCitiesMap ? Object.keys(c.stateCitiesMap) : []);

  HUBS_BY_COUNTRY[code.toUpperCase()] = {
    code: code.toUpperCase(),
    name: c?.name || code,
    states,
    cities: c?.cities || {},
    stateCitiesMap: c?.stateCitiesMap || null,
  };
}

export function getCountryDoc(code) {
  const cc = String(code || '').toUpperCase();
  return HUBS_BY_COUNTRY[cc] || null;
}

// Güvenlik için default export da verelim
const atlas = { COUNTRY_INDEX, HUBS_BY_COUNTRY, getCountryDoc };
export default atlas;
