// trips/scripts/buildAtlasState.mjs
// Node 18+ (ESM). Çalıştır:  node trips/scripts/buildAtlasState.mjs --countries=TR,US
// .env içinde: CSC_API_KEY=xxxxx  (Overpass ücretsiz; Aviationstack KULLANILMAZ)
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');
const OUT_DIR    = path.join(ROOT, 'data', 'atlas-state');
const CC_FILTER  = (process.argv.find(a => a.startsWith('--countries='))?.split('=')[1] || '')
  .split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);

const CSC_KEY    = process.env.CSC_API_KEY;
if (!CSC_KEY) { console.error('CSC_API_KEY yok (.env)'); process.exit(1); }

const HEADERS = { 'X-CSCAPI-KEY': CSC_KEY };
const CSC_BASE = 'https://api.countrystatecity.in/v1';

// Overpass (tren/otogar)
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

ensureDir(OUT_DIR);

// ----------------------- yardımcılar
function ensureDir(d){ if(!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true}); }
const norm = s => s?.normalize?.('NFKD')?.replace(/[\u0300-\u036f]/g,'')?.toLowerCase()?.trim()
  ?? String(s||'').toLowerCase().trim();
const safeCmp = (a,b)=> String(a||'').localeCompare(String(b||''), 'tr', {sensitivity:'base'});
const isNum = (v) => Number.isFinite(Number(v));

async function jget(url, {headers={}, retry=3, backoff=700, method='GET', body=null} = {}) {
  for (let i=0;i<retry;i++){
    const res = await fetch(url, { headers, redirect:'follow', method, body });
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) await sleep(backoff * (i+1));
    else throw new Error(`${res.status} ${res.statusText}`);
  }
  throw new Error(`Fetch failed after ${retry}: ${url}`);
}

// ----------------------- CSC: Ülke/State/City
async function fetchCountries(){
  const res = await jget(`${CSC_BASE}/countries`, { headers: HEADERS });
  /** @type {{name:string, iso2:string}[]} */
  const list = await res.json();
  const mapped = list.map(c => ({ code: c.iso2?.toUpperCase(), name: c.name })).filter(c => c.code && c.name);
  mapped.sort((a,b)=> safeCmp(a.name,b.name));
  return CC_FILTER.length ? mapped.filter(c => CC_FILTER.includes(c.code)) : mapped;
}

async function fetchStatesForCountry(cc){
  const res = await jget(`${CSC_BASE}/countries/${cc}/states`, { headers: HEADERS, retry: 4 });
  /** @type {{name:string, iso2:string}[]} */
  const list = await res.json();
  const states = list
    .map(s => ({ code: (s.iso2||'').toUpperCase(), name: s.name }))
    .filter(s => s.name);
  states.sort((a,b)=> safeCmp(a.name,b.name));
  return states; // [{code,name}]
}

// ⬇️ DEĞİŞTİ: şehirleri isim + koordinatla döndürüyoruz
async function fetchCitiesForState(cc, stateCode){
  const res = await jget(`${CSC_BASE}/countries/${cc}/states/${stateCode}/cities`, { headers: HEADERS, retry: 4 });
  /** @type {{name:string, latitude?:string|number, longitude?:string|number}[]} */
  const list = await res.json();
  // bazı ülkelerde lat/lon string gelebiliyor
  const mapped = (list || [])
    .filter(x => x?.name)
    .map(x => ({
      name: x.name,
      lat: isNum(x.latitude) ? Number(x.latitude) : null,
      lng: isNum(x.longitude) ? Number(x.longitude) : null,
    }));
  // aynı isim birden fazla gelirse tekille
  const byName = new Map();
  for (const c of mapped) {
    if (!byName.has(c.name)) byName.set(c.name, c);
  }
  const uniq = Array.from(byName.values()).sort((a,b)=> safeCmp(a.name,b.name));
  return uniq; // [{name,lat?,lng?}]
}

// ----------------------- Overpass: tren & otogar (ülke-geniş sorgu, sonra state’e dağıt)
function buildCountryAreaClause({ code, name }) {
  const cc = String(code || '').toUpperCase();
  const safeName = String(name || '').replace(/"/g, '\\"');
  return `
    (
      area["boundary"="administrative"]["ISO3166-1"="${cc}"];
      area["boundary"="administrative"]["ISO3166-1:alpha2"="${cc}"];
      area["boundary"="administrative"]["name"="${safeName}"];
    )->.country;
  `;
}

function overpassQueryCountry({ code, name }) {
  return `
  [out:json][timeout:180];
  ${buildCountryAreaClause({ code, name })}
  (
    // TRAIN (garlar) — şehir içi hafif raylı vb. hariç
    nwr["railway"="station"]["station"!~"^(subway|light_rail|tram)$"](area.country);
    nwr["public_transport"="station"]["train"="yes"](area.country);

    // BUS (otogar)
    nwr["amenity"="bus_station"](area.country);
    nwr["public_transport"="station"]["bus"="yes"](area.country);
  );
  out center tags;`;
}

async function overpassFetch(body, { retry = 3, backoff = 800 } = {}) {
  for (let i = 0; i < retry; i++) {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: 'data=' + encodeURIComponent(body),
    });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) await sleep(backoff * (i + 1));
    else throw new Error(`Overpass ${res.status} ${res.statusText}`);
  }
  throw new Error('Overpass fetch failed after retries');
}

function isIntercityCandidate(tags = {}) {
  const t = tags || {};
  const name = (t.name || t['name:en'] || t['official_name'] || '').toString();
  const BAD_NAME = /(metro|subway|tram|light\s*rail|banliyö|suburban|halte|halt|peron|platform|durak|stop)/i;
  if (BAD_NAME.test(name)) return false;

  if (t.railway === 'station') {
    const s = (t.station || '').toString().toLowerCase();
    if (s === 'subway' || s === 'light_rail' || s === 'tram') return false;
  }
  if ((t.public_transport || '').match(/^(platform|stop|stop_position)$/i)) return false;

  if (t.amenity === 'bus_station') return true;
  if (t.public_transport === 'station' && t.bus === 'yes') return true;
  if (t.railway === 'station') return true;
  if (t.public_transport === 'station' && t.train === 'yes') return true;

  return false;
}

function toPlace(e = {}) {
  const t = e.tags || {};
  const name = t.name || t['name:en'] || t['official_name'] || null;
  const lat = Number.isFinite(e.lat) ? e.lat : e.center?.lat;
  const lng = Number.isFinite(e.lon) ? e.lon : e.center?.lon;
  let kind = null;
  if (t.amenity === 'bus_station' || t.bus === 'yes') kind = 'bus';
  if (t.railway === 'station' || t.train === 'yes') kind = kind || 'train';
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !kind) return null;
  return { name, lat, lng, type: kind };
}

function dedupePlaces(arr = []) {
  const seen = new Set();
  const out = [];
  for (const p of arr) {
    const k = `${Math.round(p.lat * 1e4)}|${Math.round(p.lng * 1e4)}|${p.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// ----------------------- isim eşleştirme
function bestCityForPlace(placeName, cityNames){
  const want = norm(placeName||'');
  let best = cityNames.find(c => norm(c) === want) || cityNames.find(c => norm(c).startsWith(want));
  if (best) return best;
  for (const c of cityNames){ if (want.includes(norm(c))) return c; }
  let score = -1; best = null;
  for (const c of cityNames){
    const n = norm(c);
    const s = -Math.abs(n.length - want.length) + (want.startsWith(n) ? 5 : 0) + (want.includes(n) ? 2 : 0);
    if (s > score){ score = s; best = c; }
  }
  return best;
}

// ----------------------- merkez hesaplayıcılar
const median = (arr) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x,y)=>x-y);
  const mid = Math.floor(a.length/2);
  return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
};
const avg = (arr) => arr.length ? arr.reduce((s,x)=>s+x,0) / arr.length : null;

// Şehirlerden: medyan (%70) + ortalama (%30)
function centerFromCities(cityObjs = []){
  const lats = cityObjs.map(c => c.lat).filter(isNum);
  const lngs = cityObjs.map(c => c.lng).filter(isNum);
  if (!lats.length || !lngs.length) return null;
  const mlat = median(lats), mlng = median(lngs);
  const alat = avg(lats),    alng = avg(lngs);
  return { lat: 0.7*mlat + 0.3*alat, lng: 0.7*mlng + 0.3*alng };
}

// Hub’lardan: aynı mantık
function centerFromHubs(hubs = {plane:[],train:[],bus:[]}){
  const pts = []
    .concat(hubs?.plane || [], hubs?.train || [], hubs?.bus || [])
    .map(h => ({ lat: Number(h?.lat), lng: Number(h?.lng) }))
    .filter(p => isNum(p.lat) && isNum(p.lng));
  if (!pts.length) return null;
  const lats = pts.map(p=>p.lat), lngs = pts.map(p=>p.lng);
  const mlat = median(lats), mlng = median(lngs);
  const alat = avg(lats),    alng = avg(lngs);
  return { lat: 0.7*mlat + 0.3*alat, lng: 0.7*mlng + 0.3*alng };
}

// ----------------------- ana akış (STATE bazlı, havalimanı yok)
(async function main(){
  console.log('→ (STATE) Ülkeler çekiliyor (CSC)…');
  const countries = await fetchCountries(); // [{code,name}]
  console.log('Ülke sayısı:', countries.length);

  const results = [];

  for (const c of countries){
    console.log(`\n=== ${c.code} • ${c.name} (STATE) ===`);

    // 1) states + stateCitiesWithCoords + reverse index (city->state)
    const states = await fetchStatesForCountry(c.code); // [{code,name}]
    /** state -> [{name,lat?,lng?}] */
    const stateCitiesWithCoords = {};
    /** cityName -> stateName */
    const cityToState = new Map();

    if (states.length > 0) {
      const limit = pLimit(6);
      await Promise.all(states.map(st => limit(async () => {
        if (!st.code) return;
        try {
          const cities = await fetchCitiesForState(c.code, st.code); // [{name,lat?,lng?}]
          if (cities.length) {
            stateCitiesWithCoords[st.name] = cities.slice();
            for (const item of cities) cityToState.set(item.name, st.name);
          }
        } catch (e) {
          console.warn(`⚠️  ${c.code}/${st.code} şehirleri alınamadı: ${e.message}`);
        }
      })));
    }

    // 2) Overpass: ÜLKE GENİŞ - tek seferde çek, sonra state’e dağıt (ücretsiz)
    await sleep(400);
    let stations = [];
    try {
      const json = await overpassFetch(overpassQueryCountry({ code: c.code, name: c.name }), { retry: 3, backoff: 900 });
      const els = Array.isArray(json?.elements) ? json.elements : [];
      for (const e of els) {
        if (!isIntercityCandidate(e.tags)) continue;
        const p = toPlace(e);
        if (p) stations.push(p);
      }
      stations = dedupePlaces(stations);
    } catch (e) {
      console.warn('Overpass hata:', e.message);
      stations = [];
    }

    // 3) STATE bazında hub yapısı (plane boş; bus/train Overpass’ten)
    const admins = states.map(s => ({
      code: s.code ? `${c.code}-${s.code}` : `${c.code}-${s.name}`,
      name: s.name,
      center: null,
      hubs: { plane:[], train:[], bus:[] }
    }));

    const adminByName = new Map(admins.map(a => [a.name, a]));
    const allCities = Array.from(cityToState.keys()).sort(safeCmp);

    for (const st of stations){
      // İstasyonu bir şehre; şehri de state'e bağla
      const city = bestCityForPlace(st.name, allCities);
      if (!city) continue;
      const stateName = cityToState.get(city);
      if (!stateName) continue;
      const admin = adminByName.get(stateName);
      if (!admin) continue;

      const bucket = st.type === 'bus' ? admin.hubs.bus : admin.hubs.train;
      bucket.push({ name: st.name, lat: st.lat, lng: st.lng });
    }

    // temizlik ve sıralama + CENTER HESABI
    for (const a of admins){
      for (const k of ['plane','train','bus']){
        const arr = a.hubs[k] || [];
        const seen = new Set();
        a.hubs[k] = arr.filter(x=>{
          const key = `${x.name}|${Math.round(x.lat*1e6)}|${Math.round(x.lng*1e6)}`;
          if (seen.has(key)) return false; seen.add(key); return true;
        }).sort((x,y)=> safeCmp(x.name,y.name));
      }

      // 3.a) şehir koordinatlarından merkez
      const cityObjs = stateCitiesWithCoords[a.name] || [];
      let center = centerFromCities(cityObjs);

      // 3.b) gerekirse hub’lardan merkez
      if (!center) center = centerFromHubs(a.hubs);

      a.center = center || null;
    }

    const doc = {
      code: c.code,
      name: c.name,
      level: 'admin',                 // state düzeyi
      admins,                         // [{code,name,center:{lat,lng},hubs:{plane[],train[],bus[]}}]
      note: 'Airports intentionally omitted in state build. (Add later if needed.)'
    };

    const outPath = path.join(OUT_DIR, 'countries', `${c.code}.json`);
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), 'utf8');
    results.push(doc);
  }

  // paketle
  const all = {
    version: 1,
    generatedAt: new Date().toISOString(),
    countries: Object.fromEntries(results.map(r => [r.code, r])),
  };
  ensureDir(path.join(OUT_DIR));
  fs.writeFileSync(path.join(OUT_DIR, 'all.json'), JSON.stringify(all, null, 2), 'utf8');

  console.log('\n✅ (STATE) Bitti. Çıktılar: data/atlas-state/countries/<ISO2>.json ve data/atlas-state/all.json (center DOLU)');
})().catch(e => { console.error(e); process.exit(1); });
