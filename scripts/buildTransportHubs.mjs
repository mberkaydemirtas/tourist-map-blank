// scripts/buildTransportHubs.mjs
// Node 18+ (ESM)
// Kullanım ör.:
//   node scripts/buildTransportHubs.mjs --countries=TR,DE --osm=false
//   node scripts/buildTransportHubs.mjs --countries=Turkey,Germany --osm=true
//
// Girdi: trips/data/worldcities.csv (kolonlar: "country","admin_name","iso2",...)
// Çıktı: data/transport-hubs/<ISO2>.json  (şehir -> { plane[], train[], bus[] })

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(DATA_DIR, 'transport-hubs');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const CSV_PATH = path.join(ROOT, 'trips', 'data', 'worldcities.csv');

ensureDir(OUT_DIR);
ensureDir(CACHE_DIR);

const ARGS = parseArgs();
const COUNTRY_FILTER = ARGS.countries
  ? ARGS.countries.split(',').map(s => s.trim()).filter(Boolean)
  : null;
const USE_OSM = String(ARGS.osm ?? 'false').toLowerCase() === 'true';

// ----------------- KAYNAKLAR -----------------
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OURAIRPORTS_URL_PRIMARY = 'https://ourairports.com/data/airports.csv';
const OURAIRPORTS_URL_MIRROR  = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';

// ----------------- UTİL -----------------
function ensureDir(d){ if(!fs.existsSync(d)) fs.mkdirSync(d, {recursive:true}); }
function parseArgs(){
  const obj = {};
  for (const a of process.argv.slice(2)){
    const [k,v] = a.split('=');
    obj[k.replace(/^--/,'')] = v ?? true;
  }
  return obj;
}
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

const hasNormalize = typeof String.prototype.normalize === 'function';
const stripAccents = (s) => hasNormalize ? String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'') : String(s||'');
const norm = (s) => stripAccents(String(s||'').toLowerCase()).replace(/\s+/g,' ').trim();

function lev(a,b){
  const m=a.length,n=b.length;
  const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++) dp[i][0]=i;
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      const cost = a[i-1]===b[j-1]?0:1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
  }
  return dp[m][n];
}
function bestNameMatch(name, candidates){
  const n = norm(name||'');
  let best = null, bestScore = Infinity;
  for (const c of candidates){
    const d = lev(n, norm(c));
    if (d < bestScore){ bestScore = d; best = c; }
  }
  return best;
}

// ----------------- CSV (worldcities.csv) -----------------
function loadWorldCities() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`worldcities.csv bulunamadı: ${CSV_PATH}`);
  }
  const txt = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const headerRaw = lines.shift();
  const header = splitCsvLine(headerRaw);

  const idx = {
    country: header.findIndex(h => stripQuotes(h) === 'country'),
    admin:   header.findIndex(h => stripQuotes(h) === 'admin_name'),
    iso2:    header.findIndex(h => stripQuotes(h) === 'iso2'),
  };
  if (idx.country === -1 || idx.admin === -1) {
    throw new Error('CSV’de "country" veya "admin_name" kolonu bulunamadı.');
  }

  const map = new Map(); // key: norm(country)
  for (const line of lines) {
    const cols = splitCsvLine(line);
    const country = stripQuotes(cols[idx.country] || '').trim();
    const admin   = stripQuotes(cols[idx.admin]   || '').trim();
    const iso2    = idx.iso2 !== -1 ? stripQuotes(cols[idx.iso2] || '').trim() : '';

    if (!country || !admin) continue;
    const key = norm(country);
    if (!map.has(key)) {
      map.set(key, { name: country, iso2: '', cities: new Set(), iso2Counts: new Map() });
    }
    const rec = map.get(key);
    rec.cities.add(admin);
    if (iso2) {
      const k = iso2.toUpperCase();
      rec.iso2Counts.set(k, (rec.iso2Counts.get(k) || 0) + 1);
    }
  }

  const countries = [];
  for (const { name, iso2, cities, iso2Counts } of map.values()) {
    const pickIso2 = pickIso2FromCounts(iso2Counts) || guessISO2FromName(name) || name;
    countries.push({
      code: pickIso2,
      name,
      cities: Array.from(cities),
    });
  }
  return { countries };
}

function stripQuotes(s){ return String(s).replace(/^"|"$/g,''); }
function splitCsvLine(line){
  const out = [];
  let cur = '', inQ = false;
  for (let i=0;i<line.length;i++){
    const ch = line[i];
    if (ch === '"'){ inQ = !inQ; cur += ch; }
    else if (ch === ',' && !inQ){ out.push(cur); cur=''; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}
function pickIso2FromCounts(counts){
  if (!counts || counts.size === 0) return '';
  let best = '', bestCount = -1;
  for (const [k,v] of counts.entries()){
    if (v > bestCount){ best = k; bestCount = v; }
  }
  return best;
}
function guessISO2FromName(_countryName){ return ''; }

// ----------------- OurAirports (SİVİL + TARİFELİ) -----------------
async function getOurAirportsCsv(){
  const cachePath = path.join(CACHE_DIR, 'ourairports_airports.csv');

  if (fs.existsSync(cachePath)) {
    try {
      const txt = fs.readFileSync(cachePath, 'utf8');
      if (txt && txt.length > 1000) return txt;
    } catch {}
  }

  const tried = [];
  for (const url of [OURAIRPORTS_URL_PRIMARY, OURAIRPORTS_URL_MIRROR]){
    try {
      console.log('↓ OurAirports indiriliyor...', url);
      const res = await fetch(url, { timeout: 30000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      if (!txt.includes('iata_code') || !txt.includes('latitude_deg')) {
        throw new Error('Beklenen CSV kolonları yok');
      }
      ensureDir(path.dirname(cachePath));
      fs.writeFileSync(cachePath, txt, 'utf8');
      return txt;
    } catch (e) {
      tried.push(`${url} -> ${e.message}`);
    }
  }

  if (fs.existsSync(cachePath)) {
    console.warn('Uyarı: indirilemedi, cache kullanılacak.\n', tried.join('\n'));
    return fs.readFileSync(cachePath, 'utf8');
  }

  throw new Error('OurAirports indirilemedi.\n' + tried.join('\n'));
}

function parseCsv(text){
  const lines = text.split(/\r?\n/);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map(h=>stripQuotes(h));
  const idx = Object.fromEntries(header.map((h,i)=>[h,i]));
  const rows = [];
  for (let i=1;i<lines.length;i++){
    const raw = lines[i];
    if (!raw) continue;
    const cols = splitCsvLine(raw).map(stripQuotes);
    rows.push({
      id: cols[idx.id],
      ident: cols[idx.ident],
      type: (cols[idx.type]||'').toLowerCase(),
      name: cols[idx.name],
      latitude_deg: cols[idx.latitude_deg],
      longitude_deg: cols[idx.longitude_deg],
      iso_country: cols[idx.iso_country],
      iso_region: cols[idx.iso_region],
      municipality: cols[idx.municipality],
      scheduled_service: (cols[idx.scheduled_service]||'').toLowerCase(),
      gps_code: cols[idx.gps_code],
      iata_code: cols[idx.iata_code],
      local_code: cols[idx.local_code],
      home_link: cols[idx.home_link] || '',
      wikipedia_link: cols[idx.wikipedia_link] || '',
      keywords: cols[idx.keywords] || '',
    });
  }
  return rows;
}

const MILITARY_PATTERNS = [
  ' air base',' airbase',' afb ',' air station',' naval air ',' marine corps air ',
  ' air force ',' raf ',' rnas ',' army air ',' base aérienne',' fuerza aérea',
  ' aeródromo militar',' aeroporto militare',' aérea militar',' военно-воздуш',
  ' militärflugplatz',' militaire',' military',' militära',
  ' hava üssü',' üssü',' üs komutanlığı',' hava kuvvet',' jet üs',' ana jet üssü',
  ' garnizon',' kışla',' jandarma'
];
const TR_BLACKLIST = [
  'etimesgut', 'güvercinlik', 'akı ncı', 'akıncı',
  'balıkesir merkezi hava üssü','eskişehir hava üssü','diyarbakır 8. ana jet üssü'
];

function looksMilitaryByText(a){
  const hay = `${a.name||''} ${a.keywords||''} ${a.home_link||''} ${a.wikipedia_link||''}`.toLowerCase();
  if (MILITARY_PATTERNS.some(k => hay.includes(k))) return true;
  if ((a.iso_country||'').toUpperCase() === 'TR') {
    if (TR_BLACKLIST.some(k => hay.includes(k))) return true;
  }
  return false;
}

function isCivilPassengerAirport(a){
  const allowedTypes = new Set(['large_airport','medium_airport','small_airport']);
  if (!allowedTypes.has(a.type)) return false;
  if (a.scheduled_service !== 'yes') return false;
  if (looksMilitaryByText(a)) return false;
  if (!Number.isFinite(Number(a.latitude_deg)) || !Number.isFinite(Number(a.longitude_deg))) return false;
  return true;
}

function mapAirportRow(a){
  const lat = Number(a.latitude_deg);
  const lng = Number(a.longitude_deg);
  return {
    code: a.iata_code || a.ident || a.gps_code || a.local_code || a.id,
    name: a.name,
    lat, lng,
  };
}

// ----------------- OSM / Overpass -----------------
async function overpass(query){
  for (let attempt=1; attempt<=3; attempt++){
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
      body: 'data=' + encodeURIComponent(query),
    });
    if (res.status === 429){
      const wait = 3000 * attempt;
      console.log(`Overpass 429 — ${wait}ms bekleniyor...`);
      await sleep(wait);
      continue;
    }
    if (!res.ok){
      console.warn('Overpass hata:', res.status);
      await sleep(1500*attempt);
      continue;
    }
    return res.json();
  }
  throw new Error('Overpass sorgusu başarısız.');
}

function buildOverpassCountryQuery(countryName){
  return `
  [out:json][timeout:180];
  area["boundary"="administrative"]["name"="${countryName}"]->.country;

  (
    // RAIL (şehirlerarası istasyon)
    nwr["railway"="station"]["station"!="subway"]["station"!="light_rail"]["station"!="tram"](area.country);
    nwr["public_transport"="station"]["train"="yes"](area.country);

    // BUS (otogar / terminal)
    nwr["amenity"="bus_station"](area.country);
    nwr["public_transport"="station"]["bus"="yes"](area.country);
  );

  out center tags;
  `;
}

function osmToPOIs(json, desiredType /* 'train' | 'bus' | null */){
  const els = json?.elements || [];
  const out = [];

  for (const e of els){
    const tags = e.tags || {};
    const name = tags.name || tags['name:en'] || tags['official_name'] || null;

    const lat = Number.isFinite(e.lat) ? e.lat : (e.center ? e.center.lat : null);
    const lon = Number.isFinite(e.lon) ? e.lon : (e.center ? e.center.lon : null);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    let kind = null;
    if (tags.railway === 'station' || tags.train === 'yes') kind = 'train';
    if (tags.amenity === 'bus_station' || tags.bus === 'yes') kind = kind || 'bus';
    if (!kind) continue;
    if (desiredType && kind !== desiredType) continue;

    out.push({
      id: String(e.id),
      name,
      lat,
      lng: lon,
      type: kind,
      rawTags: tags,
    });
  }
  return out;
}

// şehirlerarası odaklı isim filtreleri
const TRAIN_EXCLUDE_WORDS = [
  'metro','subway','tram','light rail','banliyö','suburban','marmaray','tünel',
  'halte','stop','halt','platform','stop_position'
];
const BUS_EXCLUDE_WORDS = [
  'durak','stop','halte','platform','peron','stop_position','servis'
];

function containsAny(haystack, words){
  const s = haystack.toLowerCase();
  return words.some(w => s.includes(w));
}
function isIntercityTrainName(name){
  const s = name.toLowerCase();
  if (containsAny(s, TRAIN_EXCLUDE_WORDS)) return false;
  return true;
}
function isIntercityBusName(name){
  const s = name.toLowerCase();
  if (containsAny(s, BUS_EXCLUDE_WORDS)) return false;
  return true;
}

// ----------------- MAIN -----------------
(async function main(){
  console.log('worldcities.csv okunuyor…');
  const world = loadWorldCities();

  let list = world.countries;
  if (COUNTRY_FILTER && COUNTRY_FILTER.length){
    const filterNorm = COUNTRY_FILTER.map(x => norm(x));
    list = list.filter(c =>
      filterNorm.includes(norm(c.code)) || filterNorm.includes(norm(c.name))
    );
  }
  console.log('İşlenecek ülke sayısı:', list.length);

  // OurAirports → filtreli (sadece tarifeli sivil)
  const oaCsv = await getOurAirportsCsv();
  const oaRows = parseCsv(oaCsv);

  for (const c of list){
    const countryName = c.name;
    const iso2Raw = (c.code || '').toUpperCase();
    const iso2 = /^[A-Z]{2}$/.test(iso2Raw) ? iso2Raw : iso2Raw.slice(0,2).toUpperCase() || 'XX';

    const cityList = Array.from(new Set(c.cities));
    const result = {};
    for (const city of cityList) result[city] = { plane: [], train: [], bus: [] };

    // --- Havalimanları (OurAirports → sivil + tarifeli) ---
    const countryAirports = oaRows
      .filter(a => (a.iso_country || '').toUpperCase() === iso2)
      .filter(isCivilPassengerAirport);

    for (const ap of countryAirports){
      const cityGuess = ap.municipality || ap.name || '';
      const targetCity = bestNameMatch(cityGuess, cityList);
      if (!targetCity || !result[targetCity]) continue;
      result[targetCity].plane.push(mapAirportRow(ap));
    }

    // --- OSM: tren & otogar (opsiyonel) ---
    if (USE_OSM){
      try{
        console.log(`OSM sorgu: ${countryName} (tren/otogar)`);
        const q = buildOverpassCountryQuery(countryName);
        const json = await overpass(q);

        const trains = osmToPOIs(json, 'train').filter(p => isIntercityTrainName(p.name));
        const buses  = osmToPOIs(json, 'bus').filter(p => isIntercityBusName(p.name));

        const cityNames = cityList;

        for (const poi of trains){
          const target = bestNameMatch(poi.name, cityNames);
          if (target && result[target]) {
            result[target].train.push({ code: `OSM:${poi.id}`, name: poi.name, lat: poi.lat, lng: poi.lng });
          }
        }
        for (const poi of buses){
          const target = bestNameMatch(poi.name, cityNames);
          if (target && result[target]) {
            result[target].bus.push({ code: `OSM:${poi.id}`, name: poi.name, lat: poi.lat, lng: poi.lng });
          }
        }
      } catch(e){
        console.warn('OSM alınamadı, tren/otogar boş geçilecek:', e.message);
      }
      await sleep(1200);
    }

    // --- Temizlik / uniq / sort ---
    for (const city of Object.keys(result)){
      for (const key of ['plane','train','bus']){
        const arr = result[city][key];
        const seen = new Set();
        result[city][key] = arr.filter(x=>{
          const k = `${x.code ?? ''}::${x.name ?? ''}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).sort((a,b)=> String(a.name||'').localeCompare(String(b.name||''), 'tr'));
      }
    }

    const outPath = path.join(OUT_DIR, `${iso2}.json`);
    const payload = {
      code: iso2,
      name: countryName,
      cities: result,
      meta: {
        source: {
          airports: 'OurAirports (airports.csv, filtered: scheduled_service=yes, civil)',
          train: USE_OSM ? 'OpenStreetMap (railway=station/public_transport=station train=yes)' : 'disabled',
          bus:   USE_OSM ? 'OpenStreetMap (amenity=bus_station/public_transport=station bus=yes)' : 'disabled'
        },
        generatedAt: new Date().toISOString()
      }
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log('✅ Yazıldı:', outPath);
  }

  console.log('Bitti.');
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
