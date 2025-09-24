// tools/poi_csv_to_postgres.js
// Usage:
//   PGURL="postgres://user:pass@localhost:5432/yourdb" \
//   node tools/poi_csv_to_postgres.js ./data/turkey_poi.csv TR
//
// Installs:
//   npm i pg pg-copy-streams csv-parse

import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { parse } from 'csv-parse';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import copyFrom from 'pg-copy-streams';

const PGURL   = process.env.PGURL;
const IN_CSV  = process.argv[2];
const COUNTRY = (process.argv[3] || 'TR').toUpperCase();

if (!PGURL || !IN_CSV) {
  console.error('Usage: PGURL=postgres://... node tools/poi_csv_to_postgres.js <in.csv> [COUNTRY]');
  process.exit(1);
}

const hasNormalize = typeof String.prototype.normalize === 'function';
function trNorm(s='') {
  const str = String(s || '');
  if (!hasNormalize) return str.toLowerCase().trim();
  try {
    return str
      .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[İIı]/g,'i').replace(/[Şş]/g,'s')
      .replace(/[Ğğ]/g,'g').replace(/[Üü]/g,'u')
      .replace(/[Öö]/g,'o').replace(/[Çç]/g,'c')
      .toLowerCase().trim();
  } catch { return str.toLowerCase().trim(); }
}
const toNumber = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
function pickField(row, list, def='') {
  for (const k of list) {
    if (row[k] != null && String(row[k]).trim() !== '') return row[k];
  }
  return def;
}
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
  if (amenity === 'cafe' || amenity === 'ice_cream')       return 'cafes';
  if (amenity === 'bar' || amenity === 'pub')               return 'bars';
  if (type === 'park' || amenity === 'park' || leisure === 'park' || leisure === 'garden'
      || natural === 'wood' || natural === 'grassland' || landuse === 'forest') return 'parks';
  if (shop === 'bakery' || shop === 'confectionery' || shop === 'pastry') return 'cafes';
  return 'sights';
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS poi (
      id        TEXT PRIMARY KEY,
      country   TEXT NOT NULL,
      city      TEXT,
      category  TEXT,
      name      TEXT,
      name_norm TEXT,
      lat       DOUBLE PRECISION,
      lon       DOUBLE PRECISION,
      address   TEXT,
      source    TEXT DEFAULT 'local'
    );
    CREATE INDEX IF NOT EXISTS idx_poi_country_city ON poi(country, city);
    CREATE INDEX IF NOT EXISTS idx_poi_category     ON poi(category);
    CREATE INDEX IF NOT EXISTS idx_poi_name_norm    ON poi(name_norm);
    CREATE INDEX IF NOT EXISTS idx_poi_city_cat     ON poi(city, category);
  `);
}

function rowToTsv(row) {
  // COPY ... FROM STDIN (FORMAT text) default delimiter \t; escape tabs/newlines
  const esc = (v='') => String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  return [
    row.id, row.country, row.city, row.category,
    row.name, row.name_norm, row.lat ?? '', row.lon ?? '', row.address ?? '', 'local'
  ].map(esc).join('\t') + '\n';
}

async function main() {
  const client = new Client({ connectionString: PGURL });
  await client.connect();
  await ensureSchema(client);

  // truncate/merge stratejisi:
  //  - tek ülke yükleyeceksen: ülke bazlı sil-yükle
  await client.query('DELETE FROM poi WHERE country = $1', [COUNTRY]);

  const copyStream = client.query(copyFrom(`
    COPY poi (id,country,city,category,name,name_norm,lat,lon,address,source)
    FROM STDIN
  `));

  const csvStream = fs.createReadStream(path.resolve(IN_CSV))
    .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }));

  let count = 0;
  csvStream.on('data', (r) => {
    const name = pickField(r, ['name', 'title', 'poi_name'], '');
    const lat  = toNumber(pickField(r, ['lat', 'latitude']));
    const lon  = toNumber(pickField(r, ['lon', 'lng', 'longitude']));
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const city = pickField(r, ['province','city','town'], '');
    const category = mapCsvRowCategory(r);
    const id = String(r.id || r._id || `${COUNTRY}_${city}_${name}_${lat}_${lon}`);
    const rec = {
      id,
      country: COUNTRY,
      city,
      category,
      name,
      name_norm: trNorm(name + ' ' + (r.address || '')),
      lat,
      lon,
      address: String(r.address || '').trim(),
    };
    if (copyStream.write(rowToTsv(rec)) === false) {
      csvStream.pause();
      copyStream.once('drain', () => csvStream.resume());
    }
    count++;
    if (count % 25000 === 0) console.log('copied rows:', count);
  });

  csvStream.on('end', () => {
    copyStream.end();
  });

  await new Promise((resolve, reject) => {
    copyStream.on('finish', resolve);
    copyStream.on('error', reject);
  });

  console.log('DONE. total copied:', count);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
