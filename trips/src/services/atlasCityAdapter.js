// trips/trips/src/services/atlasCityAdapter.js
// City/şehir düzeyi atlas okuyucu (opsiyonel). Varsa kullanılır.

let ALL = null;
try {
  ALL = require('../data/atlas/all.json');
} catch (_) {
  ALL = null;
}

// JSC-dostu normalize
const asciiFold = (s) => String(s ?? '').replace(
  /[İIıŞşĞğÜüÖöÇçŁłĄąĆćĘęŃńÓóŚśŹźŻż]/g,
  (ch) => ({
    'İ':'i','I':'i','ı':'i','Ş':'s','ş':'s','Ğ':'g','ğ':'g','Ü':'u','ü':'u','Ö':'o','ö':'o','Ç':'c','ç':'c',
    'Ł':'l','ł':'l','Ą':'a','ą':'a','Ć':'c','ć':'c','Ę':'e','ę':'e','Ń':'n','ń':'n','Ó':'o','ó':'o',
    'Ś':'s','ś':'s','Ź':'z','ź':'z','Ż':'z','ż':'z',
  }[ch] || ch)
);
const norm = (s) => asciiFold(s).toLowerCase().replace(/\s+/g, ' ').trim();
const safeCmp = (a,b)=> {
  const A = norm(a), B = norm(b);
  if (A < B) return -1; if (A > B) return 1; return 0;
};

export function isAvailable(){ return !!ALL; }

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

export function listCitiesByState(cc, stateName){
  const doc = getCountryDoc(cc);
  const key = String(stateName ?? '').trim();
  if (!doc || !key) return [];

  if (doc.stateCitiesMap && typeof doc.stateCitiesMap === 'object') {
    const arr = Array.isArray(doc.stateCitiesMap[key]) ? doc.stateCitiesMap[key].slice() : [];
    arr.sort(safeCmp);
    return arr.map(name => ({ name }));
  }

  return listCities(cc);
}

export function listCities(cc){
  const doc = getCountryDoc(cc);
  if (!doc?.cities) return [];
  const arr = Object.keys(doc.cities).map(name => ({ name }));
  arr.sort((a,b)=> safeCmp(a.name,b.name));
  return arr;
}

// ✅ YENİ: şehir adını “yakın eşleşme” ile doğru key’e çevir
function resolveCityKey(doc, cityName) {
  if (!doc?.cities || !cityName) return null;

  // 1) direkt
  if (doc.cities[cityName]) return cityName;

  const q = norm(cityName);
  if (!q) return null;

  // 2) normalize edilmiş eşleşme
  const keys = Object.keys(doc.cities);
  for (const k of keys) {
    if (norm(k) === q) return k;
  }

  // 3) startsWith / includes (son çare)
  let best = null;
  for (const k of keys) {
    const nk = norm(k);
    if (nk === q) return k;
    if (!best && nk.startsWith(q)) best = k;
    if (!best && nk.includes(q)) best = k;
  }
  return best;
}

export function getHubsForCity(cc, cityName){
  const doc = getCountryDoc(cc);
  if (!doc?.cities) return { plane:[], train:[], bus:[] };

  const resolved = resolveCityKey(doc, cityName);
  const node = resolved ? doc.cities[resolved] : null;

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
