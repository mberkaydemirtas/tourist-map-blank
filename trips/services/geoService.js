// trips/services/geoService.js
// Local atlas tabanlı, senkron şehir listesi
// Public API:
//   listCountries(): {code,name}[]
//   listAdminsForCountry(code): {key,label}[]
//   listCitiesForCountryAndAdmin(code, admin): option[]
//   getCitiesForCountry(code, query): option[]
//   searchCities({countryCode, query, adminName}): Promise<option[]>
//   getCityCenter(countryLike, name, adminName?): {lat,lng}|null   ← (ekstra, opsiyonel)

import {
  COUNTRY_INDEX as COUNTRY_INDEX_CITY,
  getCountryDoc as getCityCountryDoc,
} from '../src/data/atlas/index.js';

import {
  COUNTRY_INDEX as COUNTRY_INDEX_ADMIN,
  getCountryDoc as getAdminCountryDoc,
} from '../src/data/atlas-state/index.js';

// ───────── helpers ─────────
const hasNormalize = typeof String.prototype.normalize === 'function';
const stripAccents = (s) =>
  (hasNormalize ? String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '') : String(s || ''));
const lowerTr = (s) => {
  const str = String(s || '');
  if (typeof str.toLocaleLowerCase === 'function') {
    try { return str.toLocaleLowerCase('tr'); } catch {}
  }
  return str.toLowerCase();
};
const norm = (s) => stripAccents(lowerTr(s)).replace(/\s+/g, ' ').trim();

function scoreName(q, name) {
  const n = norm(name);
  if (!q) return 0;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 900 - Math.min(n.length - q.length, 100);
  const i = n.indexOf(q);
  return i >= 0 ? 700 - Math.min(i, 300) : -1;
}
const slug = (s) =>
  stripAccents(String(s || ''))
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const trFold = (s) => String(s ?? '').replace(
  /[İIıŞşĞğÜüÖöÇç]/g,
  (ch) => ({'İ':'i','I':'i','ı':'i','Ş':'s','ş':'s','Ğ':'g','ğ':'g','Ü':'u','ü':'u','Ö':'o','ö':'o','Ç':'c','ç':'c'}[ch] || ch)
);
const normNoLocale = (s) => trFold(String(s||'')).toLowerCase().replace(/\s+/g,' ').trim();
const safeCmp = (a,b)=> {
  const A = normNoLocale(a), B = normNoLocale(b);
  if (A < B) return -1; if (A > B) return 1; return 0;
};

// ───────── country lists & names (admin > city öncelik) ─────────
const COUNTRY_NAME = {};
const COUNTRY_LIST = (() => {
  const out = [];
  const pushUnique = (arr) => {
    for (const c of (arr || [])) {
      if (!out.find(x => x.code === c.code)) out.push({ code: c.code, name: c.name });
      COUNTRY_NAME[c.code] = c.name; // isim haritasını da besle
    }
  };
  // Önce city atlas (genel)
  pushUnique(COUNTRY_INDEX_CITY);
  // Üzerine admin atlas (TR gibi) — isim önceliği burada
  for (const c of (COUNTRY_INDEX_ADMIN || [])) {
    const i = out.findIndex(x => x.code === c.code);
    if (i >= 0) out[i] = { code: c.code, name: c.name };
    else out.push({ code: c.code, name: c.name });
    COUNTRY_NAME[c.code] = c.name;
  }
  return out.sort((a,b)=> safeCmp(a.name,b.name));
})();

function countryLabel(code){
  const cc = String(code||'').toUpperCase();
  return COUNTRY_NAME[cc] || cc;
}

// ───────── düşük seviye okuma yardımcıları ─────────
function _listStates(cc){
  const docA = getAdminCountryDoc(cc);
  if (docA?.admins?.length) return docA.admins.map(a => a.name);
  const docC = getCityCountryDoc(cc);
  if (Array.isArray(docC?.states)) return docC.states.slice();
  return [];
}

// City atlas: ülke → tüm şehir adları
function _listCityNames(cc){
  const docC = getCityCountryDoc(cc);
  if (!docC?.cities) return [];
  return Object.keys(docC.cities);
}

// City atlas: ülke + admin → şehir adları (stateCitiesMap varsa)
function _listCitiesForState(cc, adminName){
  const docC = getCityCountryDoc(cc);
  const map = docC?.stateCitiesMap;
  if (!map) return [];
  const names = map[adminName] || map[String(adminName||'')] || [];
  return Array.isArray(names) ? names.slice() : [];
}

// ───────── center üreticileri ─────────
function _centroid(points){
  const arr = (points || []).filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  if (!arr.length) return null;
  const s = arr.reduce((a,p)=>({ lat: a.lat + p.lat, lng: a.lng + p.lng }), {lat:0,lng:0});
  return { lat: s.lat/arr.length, lng: s.lng/arr.length };
}

function _getAdminCenter(cc, adminName){
  const docA = getAdminCountryDoc(cc);
  if (!docA?.admins?.length) return null;
  const a = docA.admins.find(x => x.name === adminName);
  if (!a) return null;
  // 1) doğrudan center
  if (a.center && Number.isFinite(a.center.lat) && Number.isFinite(a.center.lng)) {
    return { lat: a.center.lat, lng: a.center.lng };
  }
  // 2) hub’lardan centroid
  const hubs = [
    ...(a.hubs?.plane || []),
    ...(a.hubs?.train || []),
    ...(a.hubs?.bus   || []),
  ].map(h => ({ lat: Number(h.lat), lng: Number(h.lng) }));
  const c = _centroid(hubs);
  return c || null;
}

function _getCityCenter(cc, cityName){
  const doc = getCityCountryDoc(cc);
  const raw = doc?.cities?.[cityName] ?? doc?.cities?.[String(cityName||'')];
  if (!raw) return null;
  // desteklediğimiz birkaç yaygın şekil
  const cand = raw.center || raw.location || raw.coords || raw;
  const lat = Number(cand?.lat ?? cand?.latitude);
  const lng = Number(cand?.lng ?? cand?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

// ───────── public API ─────────
export function listCountries() {
  return COUNTRY_LIST.slice();
}

/**
 * Ülke → admin listesi (US: state, TR: il).
 * İŞ KURALI: Şu an SADECE TÜRKİYE için admin gösteriyoruz.
 */
export function listAdminsForCountry(countryLike) {
  const cc = String(countryLike || '').toUpperCase();
  if (cc !== 'TR') return [];
  const states = _listStates(cc) || [];
  // Not: center’ı burada dönmüyoruz; asıl center şehir seçimine eklenecek.
  return states.map(name => ({ key: name, label: name }));
}

/**
 * Ülke + admin → şehir listesi
 * (Genel amaçlı; TR’de UI’da şehir seçimi yok ama fonksiyon korunuyor.)
 * Artık center da dönüyor.
 */
export function listCitiesForCountryAndAdmin(countryLike, adminName) {
  const cc = String(countryLike || '').toUpperCase();
  const cities = _listCitiesForState(cc, adminName) || [];
  return cities.map((name, i) => ({
    place_id: `${cc}-${slug(adminName)}-${i}`,
    main_text: name,
    description: `${name}, ${countryLabel(cc)}`,
    center: _getCityCenter(cc, name),            // ← eklendi
  }));
}

/**
 * “Tek alan” şehir listesi.
 * İŞ KURALI:
 *  - TR için: state (il) listesini “şehir gibi” sun (center ile).
 *  - TR dışı için: gerçek şehir listesi (center ile).
 */
export function getCitiesForCountry(countryLike, query = '') {
  const cc = String(countryLike||'').toUpperCase();
  const states = _listStates(cc) || [];
  const hasStates = states.length > 0;

  if (cc === 'TR' && hasStates) {
    const source = query ? fuzzyFilter(states, query) : states.slice(0, 100);
    return source.map((name, i) => toOption({
      id: `${cc}-st-${i}`,
      name,
      countryName: countryLabel(cc),
      center: _getAdminCenter(cc, name),         // ← eklendi
    }));
  }

  const allCityNames = _listCityNames(cc) || [];
  if (!query) {
    return allCityNames.slice(0, 100).map((name, i) =>
      toOption({ id: `${cc}-${i}`, name, countryName: countryLabel(cc), center: _getCityCenter(cc, name) })
    );
  }
  const scored = fuzzyScore(allCityNames, query)
    .slice(0, 200)
    .map((x, i) => toOption({ id: `${cc}-${i}`, name: x.name, countryName: countryLabel(cc), center: _getCityCenter(cc, x.name) }));
  return scored;
}

// Senkron sonucu Promise ile sar
export async function searchCities({ countryCode, query, adminName }) {
  const cc = String(countryCode || '').toUpperCase();
  if (cc === 'TR' && adminName) {
    return listCitiesForCountryAndAdmin(cc, adminName);
  }
  return getCitiesForCountry(cc, query);
}

// İsteğe bağlı util (geri uyumlu tutmak için argümanları esnek yaptım)
export function getCityCenter(countryLike, name, adminName) {
  const cc = String(countryLike || '').toUpperCase();
  if (!cc || !name) return null;
  if (cc === 'TR' && adminName) {
    return _getCityCenter(cc, name) || _getAdminCenter(cc, adminName);
  }
  return _getCityCenter(cc, name);
}

// Admin (il) merkezi; TR için kullanılır
export function getAdminCenter(countryLike, adminName) {
  const cc = String(countryLike || '').toUpperCase();
  if (!cc || !adminName) return null;
  return _getAdminCenter(cc, adminName);
}
// ── küçük yardımcılar ─────────────────────────────────────────────────────
function toOption({ id, name, countryName, center }){
  return {
    place_id: id,
    main_text: name || '',
    description: [name, countryName].filter(Boolean).join(', '),
    center: center && Number.isFinite(center.lat) && Number.isFinite(center.lng) ? center : null, // ← eklendi
  };
}
function fuzzyFilter(list, query){
  const q = norm(query);
  if (!q) return list.slice();
  return list.filter(n => norm(n).includes(q));
}
function fuzzyScore(list, query){
  const q = norm(query);
  const scored = [];
  for (const name of list) {
    const s = scoreName(q, name);
    if (s >= 0) scored.push({ name, s });
  }
  scored.sort((a,b)=> b.s - a.s || safeCmp(a.name, b.name));
  return scored;
}
