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

const norm = (s='') => s
  .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[İIı]/g,'i').replace(/[Şş]/g,'s')
  .replace(/[Ğğ]/g,'g').replace(/[Üü]/g,'u')
  .replace(/[Öö]/g,'o').replace(/[Çç]/g,'c')
  .toLowerCase().trim();

function toRows(csvText) {
  const { data } = Papa.parse(csvText, { header:true, skipEmptyLines:'greedy' });
  return data.map((r, i) => {
    const city = (r.province||r.city||r.town||'').trim();
    const category = mapCategory(r);
    return {
      id: String(r.id || r._id || `csv_${i}`),
      country: 'TR',
      city,
      category,
      name: r.name?.trim() || '(isimsiz)',
      nameNorm: norm(r.name||''),
      lat: Number(r.lat||r.latitude),
      lon: Number(r.lon||r.lng||r.longitude),
      address: '',
    };
  }).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

function writeDb(outPath, rows){
  const db = new Database(outPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF;`);
  db.exec(`CREATE TABLE IF NOT EXISTS poi (id TEXT PRIMARY KEY, country TEXT, city TEXT, category TEXT, name TEXT, nameNorm TEXT, lat REAL, lon REAL, address TEXT);`);
  const ins = db.prepare(`INSERT OR REPLACE INTO poi (id,country,city,category,name,nameNorm,lat,lon,address) VALUES (@id,@country,@city,@category,@name,@nameNorm,@lat,@lon,@address)`);
  const trx = db.transaction((batch)=>{ for (const r of batch) ins.run(r); });
  trx(rows);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_city_cat ON poi(city, category);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_city_name ON poi(city, nameNorm);`);
  db.close();
}

const csv = fs.readFileSync('data/turkey_poi.csv','utf8');
const rows = toRows(csv);
writeDb('assets/poi_TR.db', rows);
console.log('OK:', rows.length, 'rows');
