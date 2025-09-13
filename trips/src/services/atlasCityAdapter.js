// trips/trips/src/services/atlasCityAdapter.js
// City/şehir düzeyi atlas okuyucu (opsiyonel). Varsa kullanılır.

let ALL = null;
try {
  // Bu JSON yoksa (şimdilik sadece TR ile çalışıyorsan) try/catch sayesinde sorun olmaz.
  ALL = require('../data/atlas/all.json');
} catch (_) {
  ALL = null;
}

const hasNormalize = typeof String.prototype.normalize === 'function';
const stripAccents = (s) =>
  (hasNormalize ? String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '') : String(s || ''));
const norm = (s) => stripAccents(String(s || '').toLowerCase()).replace(/\s+/g, ' ').trim();
const safeCmp = (a,b)=> String(a||'').localeCompare(String(b||''), 'tr', {sensitivity:'base'});

export function isAvailable(){ return !!ALL; }

export function listCountriesCityLevel(){
  if (!ALL?.countries) return [];
  const arr = Object.keys(ALL.countries).map(cc => {
    const c = ALL.countries[cc];
    return { code: c.code, name: c.name, level: 'city' };
  });
  arr.sort((a,b)=> safeCmp(a.name,b.name));
  return arr;
}

export function getCountryDoc(cc){
  return ALL?.countries?.[String(cc).toUpperCase()] || null;
}

export function listStates(cc){
  const doc = getCountryDoc(cc);
  if (!doc) return [];
  const states = Array.isArray(doc.states) ? doc.states.slice() : [];
  states.sort(safeCmp);
  return states;
}

export function listCities(cc){
  const doc = getCountryDoc(cc);
  if (!doc?.cities) return [];
  const arr = Object.keys(doc.cities).map(name => ({ name }));
  arr.sort((a,b)=> safeCmp(a.name,b.name));
  return arr;
}

export function getHubsForCity(cc, cityName){
  const doc = getCountryDoc(cc);
  const node = doc?.cities?.[cityName];
  if (!node) return { plane:[], train:[], bus:[] };
  const dedupe = (arr=[])=>{
    const seen = new Set();
    return (arr||[]).filter(x=>{
      const k = `${norm(x.name)}|${Math.round((x.lat??0)*1e6)}|${Math.round((x.lng??0)*1e6)}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    }).sort((u,v)=> safeCmp(u.name,v.name));
  };
  return {
    plane: dedupe(node.plane),
    train: dedupe(node.train),
    bus:   dedupe(node.bus),
  };
}
