// trips/src/data/atlas/index.js
// all.json'dan hafif bir indeks + ülke dökümanları üretir

import RAW from './all.json';
import { registerRootComponent } from 'expo';
import App from '../../../../map/App';        

registerRootComponent(App);
// Küçük ülke listesi: [{code, name}]
export const COUNTRY_INDEX = Object.entries(RAW?.countries || {}).map(([code, c]) => ({
  code,
  name: c?.name || code,
}));

// Ülke dökümanı havuzu (hafif normalize)
export const HUBS_BY_COUNTRY = {};
for (const [code, c] of Object.entries(RAW?.countries || {})) {
  // Bazı atlas üretimlerinizde states / stateCitiesMap bulunmayabilir.
  // Varsa olduğu gibi alıyoruz, yoksa boş dizi/obj veriyoruz.
  const states = Array.isArray(c?.states)
    ? c.states.slice()
    : (c?.stateCitiesMap ? Object.keys(c.stateCitiesMap) : []);

  HUBS_BY_COUNTRY[code.toUpperCase()] = {
    code: code.toUpperCase(),
    name: c?.name || code,
    // States (US eyaletleri / TR illeri)
    states,
    // City -> hubs (plane/train/bus)
    cities: c?.cities || {},
    // State -> [cityName,...] (TR gibi ülkelerde illere bağlı ilçe/şehir listesi)
    stateCitiesMap: c?.stateCitiesMap || null,
  };
}

// Dışarıdan güvenli erişim
export function getCountryDoc(code) {
  const cc = String(code || '').toUpperCase();
  return HUBS_BY_COUNTRY[cc] || null;
}
