// src/services/tripsGeoNamesAdapter.js
// Yalnızca isim listesi + gerekince çözümleme (ülke/şehir).
// Metro kısıtları nedeniyle DİNAMİK import YOK — tek kaynak: all-hubs.json (statik require).

let _all = null;                   // all-hubs.json cache
let _countryIndex = null;          // [{code,name}] cache

function normalize(s) {
  try { return String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  catch { return String(s||'').toLowerCase().trim(); }
}
function slug(s) {
  return String(s||'').normalize?.('NFKD')?.replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase() || 'x';
}

/* ------------------------------- loader ------------------------------- */
// JSON’u statik require ile ve SENKRON yükle (Metro güvenli)
function loadAllSync() {
  if (_all) return _all;
  try {
    // Bu dosyanın konumu: src/services/...
    // all-hubs.json konumu: projectRoot/data/transport-hubs/all-hubs.json
    // Yolun sende farklıysa burayı ona göre düzelt:
    //   - eğer src/data/transport-hubs/all-hubs.json altındaysa: require('../data/transport-hubs/all-hubs.json')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _all = require('../../data/transport-hubs/all-hubs.json');
  } catch (e) {
    console.error('[tripsGeoNamesAdapter] all-hubs.json yüklenemedi. Path doğru mu?', e?.message);
    _all = null;
  }
  return _all;
}

function loadCountrySync(code) {
  const cc = String(code||'').toUpperCase();
  const all = loadAllSync();
  return all?.countries?.[cc] || null;
}

/* ------------------------------ country API ---------------------------- */

/** Sadece ülke adları (alfabetik) */
export async function listCountryNames() {
  const all = loadAllSync();
  if (!all?.countries) return [];
  if (!_countryIndex) {
    _countryIndex = Object.values(all.countries)
      .map(c => ({ code: c.code, name: c.name }))
      .sort((a,b)=> String(a.name||'').localeCompare(String(b.name||''), 'tr'));
  }
  return _countryIndex.map(c => c.name);
}

/** Ülke adı → { code, name } çözümleme */
export async function resolveCountryByName(displayName) {
  const want = normalize(displayName);
  if (!want) return null;

  const all = loadAllSync();
  const list = all?.countries
    ? Object.values(all.countries).map(c => ({ code:c.code, name:c.name }))
    : [];

  if (!list.length) return null;
  let hit = list.find(c => normalize(c.name) === want);
  if (!hit) hit = list.find(c => normalize(c.name).startsWith(want));
  return hit || null;
}

/* ------------------------------- city API ------------------------------ */

/** Ülke → sadece şehir adları listesi */
export async function listCityNames(countryCode) {
  const doc = loadCountrySync(countryCode);
  if (!doc?.cities) return [];
  return Object.keys(doc.cities).sort((a,b)=> String(a||'').localeCompare(String(b||''), 'tr'));
}

/** Ülke+şehir adı → { id, name, countryCode, center? } çözümleme */
export async function resolveCityByName(countryCode, cityDisplayName, { withCenter=true } = {}) {
  const cc = String(countryCode||'').toUpperCase();
  const want = normalize(cityDisplayName);
  const doc = loadCountrySync(cc);
  if (!doc?.cities) return null;

  const keys = Object.keys(doc.cities);
  const exact = keys.find(k => normalize(k) === want);
  const key = exact ?? keys.find(k => normalize(k).startsWith(want));
  if (!key) return null;

  const id = `${cc}-${slug(key)}`;
  const out = { id, name: key, countryCode: cc };
  if (withCenter) out.center = computeCityCenter(doc.cities[key]);
  return out;
}

/* --------------------------- center computation ------------------------ */

function computeCityCenter(cityGroup /* {plane[],train[],bus[]} */) {
  const pts = [];
  for (const t of ['plane','train','bus']) {
    for (const it of (cityGroup?.[t] || [])) {
      const lat = Number(it.lat), lng = Number(it.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push([lat,lng]);
    }
  }
  if (!pts.length) return null;
  const sum = pts.reduce((acc,[a,b]) => [acc[0]+a, acc[1]+b], [0,0]);
  return { lat: sum[0]/pts.length, lng: sum[1]/pts.length };
}

/* ------------------------ küçük yardımcılar (ops.) --------------------- */

export async function searchCountryNames(query) {
  const q = normalize(query||'');
  const all = await listCountryNames();
  if (!q) return all;
  const starts = all.filter(n => normalize(n).startsWith(q));
  const contains = all.filter(n => !starts.includes(n) && normalize(n).includes(q));
  return [...starts, ...contains];
}

export async function searchCityNames(countryCode, query) {
  const q = normalize(query||'');
  const all = await listCityNames(countryCode);
  if (!q) return all.slice(0, 200); // UI'ı boğmamak için
  const starts = all.filter(n => normalize(n).startsWith(q));
  const contains = all.filter(n => !starts.includes(n) && normalize(n).includes(q));
  return [...starts, ...contains];
}
