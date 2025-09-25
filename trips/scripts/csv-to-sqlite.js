// trips/scripts/csv-to-sqlite.js
import fs from 'node:fs';
import Papa from 'papaparse';
import Database from 'better-sqlite3';

const mapCategory = (row) => {
  const amenity = (row.amenity||'').toLowerCase().trim();
  const tourism = (row.tourism||'').toLowerCase().trim();
  const shop    = (row.shop||'').toLowerCase().trim();
  const type    = (row.type||'').toLowerCase().trim();
  const leisure = (row.leisure||'').toLowerCase().trim();
  const natural = (row.natural||'').toLowerCase().trim();
  const landuse = (row.landuse||'').toLowerCase().trim();
  if (tourism === 'museum') return 'museums';
  if (tourism === 'attraction' || tourism === 'artwork' || type.includes('historic')) return 'sights';
  if (amenity === 'restaurant' || amenity === 'fast_food') return 'restaurants';
  if (amenity === 'cafe' || amenity === 'ice_cream') return 'cafes';
  if (amenity === 'bar' || amenity === 'pub') return 'bars';
  if (type==='park'||amenity==='park'||leisure==='park'||leisure==='garden'||natural==='wood'||natural==='grassland'||landuse==='forest') return 'parks';
  if (shop==='bakery'||shop==='confectionery'||shop==='pastry') return 'cafes';
  return 'sights';
};

const norm = (s='') => {
  try {
    return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[İIı]/g,'i').replace(/[Şş]/g,'s')
      .replace(/[Ğğ]/g,'g').replace(/[Üü]/g,'u')
      .replace(/[Öö]/g,'o').replace(/[Çç]/g,'c')
      .toLowerCase().trim();
  } catch {
    return String(s||'').toLowerCase().trim();
  }
};

function toRows(csvText) {
  const { data } = Papa.parse(csvText, { header:true, skipEmptyLines:'greedy' });
  return data.map((r, i) => {
    const city = (r.province||r.city||r.town||'').trim();
    const category = mapCategory(r);
    const lat = Number(r.lat??r.latitude);
    const lon = Number(r.lon??r.lng??r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      id: String(r.id || r._id || `csv_${i}`),
      country: 'TR',
      city,
      category,
      name: r.name?.trim() || '(isimsiz)',
      nameNorm: norm((r.name||'') + ' ' + (r.address||'')),
      lat, lon,
      address: String(r.address||'').trim(),
    };
  }).filter(Boolean);
}

function writeDb(outPath, rows){
  const db = new Database(outPath);
  // WAL ile hızlı yaz, sonra checkpoint + DELETE’a dön
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY;`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS poi (
      id TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      city TEXT,
      category TEXT,
      name TEXT,
      nameNorm TEXT,
      lat REAL,
      lon REAL,
      address TEXT,
      source TEXT DEFAULT 'local'
    );
  `);

  const ins = db.prepare(`
    INSERT OR REPLACE INTO poi
    (id,country,city,category,name,nameNorm,lat,lon,address,source)
    VALUES (@id,@country,@city,@category,@name,@nameNorm,@lat,@lon,@address,'local')
  `);

  const trx = db.transaction((batch)=>{ for (const r of batch) ins.run(r); });
  trx(rows);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_poi_country_city ON poi(country, city);
    CREATE INDEX IF NOT EXISTS idx_poi_category ON poi(category);
    CREATE INDEX IF NOT EXISTS idx_poi_nameNorm ON poi(nameNorm);
    CREATE INDEX IF NOT EXISTS idx_poi_city_cat ON poi(city, category);
  `);

  // 🔴 KRİTİK: WAL’i ana .db’ye flushla, sonra DELETE moduna dön ve vakumla
  db.exec(`PRAGMA wal_checkpoint(FULL);`);
  db.exec(`PRAGMA journal_mode=DELETE;`);
  db.exec(`VACUUM;`);

  db.close();
}

const csv = fs.readFileSync('data/turkey_poi.csv','utf8');
const rows = toRows(csv);
writeDb('assets/poi_TR.db', rows);
console.log('OK:', rows.length, 'rows');
