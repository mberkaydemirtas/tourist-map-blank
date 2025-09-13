// trips/trips/src/services/hubsCatalog.js
import {
  listCountriesAdminLevel,
  listAdmins as listAdminsState,
  getHubsForAdmin,
  getCountryDoc as getCountryDocState,
} from './atlasStateAdapter';

import {
  isAvailable as cityAtlasAvailable,
  listCountriesCityLevel,
  listStates as listStatesCity,
  listCities as listCitiesCity,
  getHubsForCity,
  getCountryDoc as getCountryDocCity,
} from './atlasCityAdapter';

const safeCmp = (a,b) => String(a||'').localeCompare(String(b||''), 'tr', {sensitivity:'base'});

function detectModeForCountry(cc){
  const sDoc = getCountryDocState(cc);
  if (sDoc?.level === 'admin' || String(cc).toUpperCase() === 'TR') return 'admin'; // TR zorunlu admin
  const cDoc = getCountryDocCity(cc);
  if (cDoc?.cities) return 'city';
  return 'admin';
}

export function listCountries(){
  const admin = listCountriesAdminLevel();        // atlas-state
  const city  = cityAtlasAvailable() ? listCountriesCityLevel() : [];
  const seen = new Set(admin.map(x => x.code));
  const merged = admin.concat(city.filter(x => !seen.has(x.code)));
  merged.sort((a,b)=> safeCmp(a.name,b.name));
  return merged;
}

export function getCountryMode(cc){ return detectModeForCountry(cc); }
export function listAdmins(cc){ return detectModeForCountry(cc)==='admin' ? listAdminsState(cc) : []; }
export function listCities(cc){ return detectModeForCountry(cc)==='city'  ? listCitiesCity(cc).map(x=>x.name) : []; }
export function listStatesInCityAtlas(cc){ return detectModeForCountry(cc)==='city' ? listStatesCity(cc) : []; }

/** StartEndQuestion için tek giriş */
export function getHubs({ country, admin, city }){
  const mode = detectModeForCountry(country);
  if (mode === 'admin') {
    if (!admin) return { plane:[], train:[], bus:[] };
    return getHubsForAdmin(country, admin);
  } else {
    if (!city) return { plane:[], train:[], bus:[] };
    return getHubsForCity(country, city);
  }
}
