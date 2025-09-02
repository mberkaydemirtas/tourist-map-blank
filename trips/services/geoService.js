// src/services/geoService.js
// TRIPS (isim-önce) — transport-hubs tabanlı
// - API imzaları öncekiyle uyumlu:
//   listCountries(): {code,name}[]
//   getCitiesForCountry(code, query): option[]
//   searchCities({countryCode, query}): Promise<option[]>

// Ülke listesini stabil tutmak için mevcut COUNTRY_LIST'i kullanıyoruz.
// Şehir isimleri ise transport-hubs'tan (all-hubs.json ya da <CC>.json) yükleniyor.
import { COUNTRY_LIST } from '../src/data/countryList.js';   // mevcut ülke listesi (sync)

// İsim-önce adaptör (transport-hubs kaynaklı)
import {
  listCityNames,
} from '../../scripts/services/tripsGeoNamesAdapter.js';

/* -------------------------------- helpers -------------------------------- */

const hasNormalize = typeof String.prototype.normalize === 'function';
const stripAccents = (s) =>
  (hasNormalize ? String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '') : String(s || ''));
const norm = (s) => stripAccents(String(s || '').toLowerCase()).replace(/\s+/g, ' ').trim();

// Hermes/Android kararlılığı için basit kıyas
function safeCmp(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  if (sa === sb) return 0;
  return sa < sb ? -1 : 1;
}

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

/* ------------------------------- STATE -------------------------------- */

// CITY_POOL, transport-hubs kaynaklı şehir isimlerini option'a çevrilmiş halde tutar.
const CITY_POOL = {};   // { CC: [{id,name,countryName}] }
const COUNTRY_NAME = {};
for (const c of COUNTRY_LIST) COUNTRY_NAME[c.code] = c.name;

// basit cache bayrağı
const LOADED = {}; // { CC: true }

/* --------------------------- CC resolve/alias --------------------------- */

const COUNTRY_ALIASES = {
  TR: ['tr', 'turkey', 'türkiye', 'turkiye', 'tc', 't.c.', 'türkiye cumhuriyeti', 'turkiye cumhuriyeti'],
  US: ['us', 'usa', 'united states', 'america', 'united states of america'],
  GB: ['uk', 'gb', 'great britain', 'united kingdom', 'england'],
  DK: ['dk', 'denmark', 'danmark', 'danimarka'],
};

function resolveCountryCode(input) {
  if (!input) return '';
  const raw = String(input).trim();
  const up = raw.length === 2 ? raw.toUpperCase() : raw;
  if (/^[A-Za-z]{2}$/.test(up)) return up.toUpperCase();

  const lower = norm(raw);
  for (const [cc, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.some((a) => norm(a) === lower)) return cc;
  }

  const hit = COUNTRY_LIST.find((c) => norm(c.name) === lower);
  return hit ? hit.code : up.toUpperCase();
}

/* ----------------------------- loaders ----------------------------- */

async function ensureCountryLoaded(isoLike) {
  const cc = resolveCountryCode(isoLike);
  if (!cc || LOADED[cc]) return;

  try {
    const names = await listCityNames(cc); // ['Ankara','İstanbul',...]
    const cname = COUNTRY_NAME[cc] || cc;
    const seen = new Set();
    const items = new Array(names.length);

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const base = `${cc}-${slug(name) || 'x'}`;
      let id = base, n = 1;
      while (seen.has(id)) { n += 1; id = `${base}-${n}`; }
      seen.add(id);
      items[i] = { id, name, countryName: cname };
    }

    if (items.length > 1 && items.length <= 500) {
      items.sort((a, b) => safeCmp(a.name, b.name));
    }

    CITY_POOL[cc] = items;
  } catch (e) {
    console.warn('[geoService] city load failed', isoLike, e?.message);
    CITY_POOL[cc] = CITY_POOL[cc] || [];
  } finally {
    LOADED[cc] = true;
  }
}

/* --------------------------------- API --------------------------------- */

export function listCountries() {
  // Sync, mevcut COUNTRY_LIST üstünden
  return COUNTRY_LIST
    .map((c) => ({ code: c.code, name: c.name }))
    .sort((a, b) => safeCmp(a.name, b.name));
}

const DEFAULT_EMPTY_QUERY_LIMIT = 100;  // boş aramada
const DEFAULT_SEARCH_LIMIT = 200;       // aramada

export function listAdminsForCountry() {
  // Trips akışında admin ayrımı yok; API uyumluluğu için boş.
  return [];
}

export function listCitiesForCountryAndAdmin() {
  // admins-only senaryosu için boş
  return [];
}

export function getCitiesForCountry(countryLike, query = '') {
  // Sync görünür; ensureCountryLoaded async çalıştığında WhereToQuestion zaten
  // InteractionManager ile searchCities çağırarak cache'i tazeler.
  const cc = resolveCountryCode(countryLike);
  const all = CITY_POOL[cc] || [];
  if (!query) return all.slice(0, DEFAULT_EMPTY_QUERY_LIMIT).map(toOption);

  const q = norm(query);
  const scored = [];
  for (let i = 0; i < all.length; i++) {
    const item = all[i];
    const s = Math.max(
      scoreName(q, item.name),
      scoreName(q, `${item.name}, ${item.countryName}`)
    );
    if (s >= 0) scored.push({ item, s });
  }
  scored.sort((a, b) => b.s - a.s || safeCmp(a.item.name, b.item.name));
  return scored.slice(0, DEFAULT_SEARCH_LIMIT).map((x) => toOption(x.item));
}

export async function searchCities({ countryCode, query }) {
  const cc = resolveCountryCode(countryCode);
  await ensureCountryLoaded(cc);
  return getCitiesForCountry(cc, query);
}

export async function getCityCenter() {
  // Trips'te şehir merkezi, gerektiğinde StartEnd/Trips tarafında hub ortalamasıyla çözümleniyor.
  return null;
}

export function getCountryCities() {
  // Debug/araç fonksiyonu
  return Object.keys(CITY_POOL).map((cc) => ({
    code: cc,
    name: COUNTRY_NAME[cc] || cc,
    cities: CITY_POOL[cc],
    admins: [],
  }));
}
export const COUNTRY_CITIES = getCountryCities();

/* ------------------------------- helpers ------------------------------- */

function toOption(obj) {
  const { id, name, countryName } = obj || {};
  return {
    place_id: id,
    main_text: name || '',
    description: [name, countryName].filter(Boolean).join(', '),
  };
}
