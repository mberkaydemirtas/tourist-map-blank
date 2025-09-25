// tools/poi_csv_to_sqlite.js
// Usage:
//   node tools/poi_csv_to_sqlite.js ./data/turkey_poi.csv ./assets/poi_TR.db TR
//
// Installs:
//   npm i better-sqlite3 csv-parse

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { parse } from 'csv-parse';

const IN_CSV   = process.argv[2];
const OUT_DB   = process.argv[3] || './poi_TR.db';
const COUNTRY  = (process.argv[4] || 'TR').toUpperCase();

if (!IN_CSV) {
  console.error('Usage: node tools/poi_csv_to_sqlite.js <in.csv> <out.db> [COUNTRY]');
  process.exit(1);
}

/* -------------------- utils (normalize + category map) -------------------- */
const hasNormalize = typeof String.prototype.normalize === 'function';
function trNorm(s='') {
  const str = String(s || '');
  if (!hasNormalize) return str.toLowerCase().trim();
  try {
    return str
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[İIı]/g, 'i')
      .replace(/[Şş]/g, 's')
      .replace(/[Ğğ]/g, 'g')
      .replace(/[Üü]/g, 'u')
      .replace(/[Öö]/g, 'o')
      .replace(/[Çç]/g, 'c')
      .toLowerCase()
      .trim();
  } catch { return str.toLowerCase().trim(); }
}
const toNumber = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

function mapCsvRowCategory(row) {
  const amenity = String(row.amenity || '').trim().toLowerCase();
  const tourism = String(row.tourism || '').trim().toLowerCase();
  const shop    = String(row.shop || '').trim().toLowerCase();
  const type    = String(row.type || '').trim().toLowerCase();
  const leisure = String(row.leisure || '').trim().toLowerCase();
  const natural = String(row.natural || '').trim().toLowerCase();
  const landuse = String(row.landuse || '').trim().toLowerCase();

  if (tourism === 'museum') return 'museums';
  if (tourism === 'attraction' || tourism === 'artwork' || type.includes('historic')) return 'sights';
  if (amenity === 'restaurant' || amenity === 'fast_food') return 'restaurants';
  if (amenity === 'cafe' || amenity === 'ice_cream') return 'cafes';
  if (amenity === 'bar' || amenity === 'pub') return 'bars';

  if (
    type === 'park' || amenity === 'park' ||
    leisure === 'park' || leisure === 'garden' ||
    natural === 'wood' || natural === 'grassland' ||
    landuse === 'forest'
  ) return 'parks';

  if (shop === 'bakery' || shop === 'confectionery' || shop === 'pastry') return 'cafes';
  return 'sights';
}

function pickField(row, list, def='') {
  for (const k of list) {
    if (row[k] != null && String(row[k]).trim() !== '') return row[k];
  }
  return def;
}

/* --------------------------- sqlite prepare --------------------------- */
// OUT_DB klasörü yoksa oluştur
fs.mkdirSync(path.dirname(path.resolve(OUT_DB)), { recursive: true });

// Çıktı dosyasını sıfırla
fs.rmSync(OUT_DB, { force: true });

const db = new Database(OUT_DB);
// Yazım sırasında WAL performansı; en sonda checkpoint edip DELETE’a döneceğiz
db.pragma('journal_mode = WAL');
db.pragma('synchronous = OFF');
db.pragma('temp_store = MEMORY');

db.exec(`
CREATE TABLE IF NOT EXISTS poi (
  id        TEXT PRIMARY KEY,
  country   TEXT NOT NULL,
  city      TEXT,
  category  TEXT,
  name      TEXT,
  nameNorm  TEXT,
  lat       REAL,
  lon       REAL,
  address   TEXT,
  source    TEXT DEFAULT 'local'
);
-- indeksleri en sonda oluşturacağız
`);

const insert = db.prepare(`
  INSERT OR REPLACE INTO poi
  (id, country, city, category, name, nameNorm, lat, lon, address, source)
  VALUES (@id, @country, @city, @category, @name, @nameNorm, @lat, @lon, @address, 'local')
`);

const insertMany = db.transaction((rows) => {
  for (const r of rows) insert.run(r);
});

/* ---------------- CSV stream parse + batch insert ---------------- */
const BATCH = 2000;
let batch = [];
let total = 0;

const parser = fs.createReadStream(path.resolve(IN_CSV))
  .pipe(parse({ columns: true, relax_column_count: true, skip_empty_lines: true, trim: true }));

parser.on('data', (row) => {
  // schema: province,name,lat,lon,type,id,amenity,shop,tourism,(optional: leisure,natural,landuse)
  const name = pickField(row, ['name', 'title', 'poi_name'], '');
  const lat  = toNumber(pickField(row, ['lat', 'latitude']));
  const lon  = toNumber(pickField(row, ['lon', 'lng', 'longitude']));
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const city = pickField(row, ['province','city','town'], '');
  const category = mapCsvRowCategory(row);
  const id = String(row.id || row._id || `${COUNTRY}_${city}_${name}_${lat}_${lon}`);
  const rec = {
    id,
    country: COUNTRY,
    city,
    category,
    name,
    nameNorm: trNorm(name + ' ' + (row.address || '')),
    lat,
    lon,
    address: String(row.address || '').trim(),
  };
  batch.push(rec);
  if (batch.length >= BATCH) {
    insertMany(batch);
    total += batch.length;
    batch = [];
    if (total % 10000 === 0) console.log('inserted:', total);
  }
});

parser.on('end', () => {
  if (batch.length) { insertMany(batch); total += batch.length; }
  console.log('DONE. total rows:', total);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_poi_country_city ON poi(country, city);
    CREATE INDEX IF NOT EXISTS idx_poi_category ON poi(category);
    CREATE INDEX IF NOT EXISTS idx_poi_nameNorm ON poi(nameNorm);
    CREATE INDEX IF NOT EXISTS idx_poi_city_cat ON poi(city, category);
  `);

  // 🔴 KRİTİK: WAL → ana .db’ye yazdır, sonra DELETE moduna dön ve vacuımla
  db.exec(`PRAGMA wal_checkpoint(FULL);`);
  db.exec(`PRAGMA journal_mode=DELETE;`);
  db.exec(`VACUUM;`);

  db.close();
  console.log('SQLite ready at:', OUT_DB);
});

parser.on('error', (err) => {
  console.error('CSV parse error:', err);
  process.exit(1);
});
