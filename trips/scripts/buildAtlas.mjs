// trips/scripts/buildAtlas.mjs
// Node 18+ (ESM). Çalıştır:  node trips/scripts/buildAtlas.mjs --countries=TR,DE
// .env içinde: CSC_API_KEY=xxxxx  ve  AVIATIONSTACK_KEY=yyyyy
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';
// 🔧 ücretli API (şehir bazlı havalimanı eşlemesi için ülke toplamını kullanıyoruz)
import { fetchAirportsAviationstack } from './airports.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, '..');
const OUT_DIR    = path.join(ROOT, 'data', 'atlas');
const CC_FILTER  = (process.argv.find(a => a.startsWith('--countries='))?.split('=')[1] || '')
  .split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);

const CSC_KEY    = process.env.CSC_API_KEY;
if (!CSC_KEY) { console.error('CSC_API_KEY yok (.env)'); process.exit(1); }

const HEADERS = { 'X-CSCAPI-KEY': CSC_KEY };
const CSC_BASE = 'https://api.countrystatecity.in/v1';

ensureDir(OUT_DIR);

// ----------------------- yardımcılar
function ensureDir(d){ if(!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true}); }
const norm = s => s?.normalize?.('NFKD')?.replace(/[\u0300-\u036f]/g,'')?.toLowerCase()?.trim()
  ?? String(s||'').toLowerCase().trim();
const safeCmp = (a,b)=> String(a||'').localeCompare(String(b||''), 'tr', {sensitivity:'base'});

// askıda kalmaması için fetch wrapper
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

async function fetchCitiesForState(cc, stateCode){
  const res = await jget(`${CSC_BASE}/countries/${cc}/states/${stateCode}/cities`, { headers: HEADERS, retry: 4 });
  /** @type {{name:string, latitude?:string|number, longitude?:string|number}[]} */
  const list = await res.json();
  const names = Array.from(new Set(list.map(x => x.name).filter(Boolean))).sort(safeCmp);
  return names;
}

// (Eski toplu yol — fallback)
async function fetchCitiesForCountry(cc){
  const states = await fetchStatesForCountry(cc);
  if (states.length === 0) return [];
  const limit = pLimit(6);
  const allSets = await Promise.all(states.map(st => limit(async () => {
    if (!st.code) return new Set();
    try{
      const cities = await fetchCitiesForState(cc, st.code);
      return new Set(cities);
    }catch(e){
      console.warn(`⚠️  ${cc}/${st.code} şehirleri alınamadı: ${e.message}`);
      return new Set();
    }
  })));
  const merged = new Set();
  for (const s of allSets){ for (const name of s) merged.add(name); }
  return Array.from(merged).sort(safeCmp);
}

// ----------------------- eşleştirme helper’ı
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

// ----------------------- ana akış (şehir bazlı)
(async function main(){
  console.log('→ Ülkeler çekiliyor (CSC)…');
  const countries = await fetchCountries(); // [{code,name}]
  console.log('Ülke sayısı:', countries.length);

  const results = [];

  for (const c of countries){
    console.log(`\n=== ${c.code} • ${c.name} ===`);

    // 1) states ve stateCitiesMap
    const states = await fetchStatesForCountry(c.code); // [{code,name}]
    const stateCitiesMap = {};
    const allCitySet = new Set();

    if (states.length > 0) {
      const limit = pLimit(6);
      await Promise.all(states.map(st => limit(async () => {
        if (!st.code) return;
        try {
          const cities = await fetchCitiesForState(c.code, st.code);
          if (cities.length) {
            stateCitiesMap[st.name] = cities.slice();        // state -> [cityName,...]
            for (const nm of cities) allCitySet.add(nm);
          }
        } catch (e) {
          console.warn(`⚠️  ${c.code}/${st.code} şehirleri alınamadı: ${e.message}`);
        }
      })));
    }

    if (states.length === 0 || allCitySet.size === 0) {
      console.warn(`ℹ️  ${c.code}: state bazlı şehir bulunamadı, ülke toplamından türetilecek.`);
      const mergedCities = await fetchCitiesForCountry(c.code);
      for (const nm of mergedCities) allCitySet.add(nm);
    }

    const cities = Array.from(allCitySet).sort(safeCmp);
    console.log('State sayısı:', states.length, ' • Şehir sayısı:', cities.length);

    // 3) HAVAALANLARI (Aviationstack) — ülke bazlı çek
    const airports = await fetchAirportsAviationstack({
      countryIso2: c.code,
      limitPerPage: 100,
      sleepMs: 150,
    });

    // 4) şehre bağla (bus/train burada yok; bu script şehir bazında havalimanı odaklı)
    const cityGroups = {};
    for (const name of cities) cityGroups[name] = { plane:[], train:[], bus:[] };

    for (const ap of airports){
      const city = bestCityForPlace(ap.name, cities);
      if (city) cityGroups[city].plane.push({ name: ap.name, lat: ap.lat, lng: ap.lng });
    }

    // temizlik ve sıralama
    for (const city of Object.keys(cityGroups)){
      for (const k of ['plane','train','bus']){
        const arr = cityGroups[city][k];
        const seen = new Set();
        cityGroups[city][k] = arr.filter(x=>{
          const key = `${x.name}|${Math.round(x.lat*1e6)}|${Math.round(x.lng*1e6)}`;
          if (seen.has(key)) return false; seen.add(key); return true;
        }).sort((a,b)=> safeCmp(a.name,b.name));
      }
    }

    // 6) Ülke dokümanı: states + stateCitiesMap + cities (şehir bazlı)
    const doc = {
      code: c.code,
      name: c.name,
      states: states.map(s => s.name),
      stateCitiesMap: Object.keys(stateCitiesMap).length ? stateCitiesMap : null,
      cities: cityGroups
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

  console.log('\n✅ Bitti. Çıktılar: data/atlas/countries/<ISO2>.json ve data/atlas/all.json');
})().catch(e => { console.error(e); process.exit(1); });
