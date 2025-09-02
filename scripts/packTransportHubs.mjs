// scripts/packTransportHubs.mjs
// Node 18+ (ESM)
// Varsayım: data/transport-hubs altında XX.json dosyaları var (buildTransportHubs ile üretildi)
// Çıktı: data/transport-hubs/all-hubs.json, hubs.geojson, (opsiyonel) hubs.csv

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'transport-hubs');

ensureDir(OUT_DIR);
function ensureDir(d){ if(!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function readCountryFiles() {
  const files = fs.readdirSync(OUT_DIR).filter(f => /^[A-Z]{2}\.json$/.test(f));
  const countries = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
      if (j && j.code && j.cities) countries.push(j);
    } catch (e) {
      console.warn('Dosya okunamadı, atlanıyor:', f, e.message);
    }
  }
  return countries;
}

function buildAllHubsJson(countryObjs) {
  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    countries: {}
  };
  for (const c of countryObjs) {
    out.countries[c.code] = {
      code: c.code,
      name: c.name,
      cities: c.cities
    };
  }
  return out;
}

function toFeatures(countryObjs) {
  const feats = [];
  for (const c of countryObjs) {
    for (const [city, groups] of Object.entries(c.cities || {})) {
      for (const type of ['plane','train','bus']) {
        for (const item of (groups[type] || [])) {
          const { lat, lng, name, code } = item;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          feats.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {
              country_code: c.code,
              country_name: c.name,
              city,
              type,
              name,
              code: code || null
            }
          });
        }
      }
    }
  }
  return feats;
}

function dedupeFeatures(features) {
  const seen = new Set();
  const res = [];
  for (const f of features) {
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    const key = [
      p.type, p.country_code, p.city, (p.name||'').toLowerCase().trim(),
      Math.round(lat * 1e6), Math.round(lng * 1e6)
    ].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    res.push(f);
  }
  return res;
}

function toCsv(features){
  const head = 'country_code,country_name,city,type,name,code,lat,lng';
  const rows = features.map(f=>{
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    const esc = (s)=> `"${String(s??'').replace(/"/g,'""')}"`;
    return [p.country_code, p.country_name, p.city, p.type, p.name, p.code, lat, lng].map(esc).join(',');
  });
  return [head, ...rows].join('\n');
}

(function main(){
  const countryObjs = readCountryFiles();
  if (!countryObjs.length) {
    console.error('Hiç ülke dosyası bulunamadı. Önce buildTransportHubs.mjs çalıştırın.');
    process.exit(1);
  }

  // 1) all-hubs.json
  const allHubs = buildAllHubsJson(countryObjs);
  const allJsonPath = path.join(OUT_DIR, 'all-hubs.json');
  fs.writeFileSync(allJsonPath, JSON.stringify(allHubs, null, 2), 'utf8');
  console.log('✅ Yazıldı:', allJsonPath);

  // 2) hubs.geojson
  const feats = dedupeFeatures(toFeatures(countryObjs));
  const geo = { type: 'FeatureCollection', features: feats };
  const geoPath = path.join(OUT_DIR, 'hubs.geojson');
  fs.writeFileSync(geoPath, JSON.stringify(geo), 'utf8');
  console.log('✅ Yazıldı:', geoPath);

  // 3) İsteğe bağlı CSV (analiz için)
  const csvPath = path.join(OUT_DIR, 'hubs.csv');
  fs.writeFileSync(csvPath, toCsv(feats), 'utf8');
  console.log('✅ Yazıldı:', csvPath);
})();
