// server/lib/matchDB.js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// ---- DB path ----
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'poi_match.db');
const db = new Database(DB_FILE);

// ---- helpers ----
function round5(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1e5) / 1e5;
}

function stripBrackets(s = '') {
  return String(s).replace(/\s*[\(\[\{].*?[\)\]\}]\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
function removeSuffixes(s = '') {
  const kill = [
    'restaurant','restoran','cafe','kafe','pastane','patisserie','bakery',
    'bar','pub','coffee','kahve','lokanta','büfe','bufe','branch','şubesi','sube',
    'ankara','istanbul','izmir'
  ];
  let t = String(s || '').toLowerCase();
  t = t.replace(/[-–—•|]+/g, ' ');
  for (let i = 0; i < 3; i++) t = t.replace(new RegExp(`\\b(${kill.join('|')})\\b`, 'g'), ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length ? t : String(s || '').toLowerCase();
}
function trFold(s = '') {
  const str = String(s || '');
  try {
    return str
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch => ({ İ:'I', I:'I', ı:'i', Ş:'S', ş:'s', Ğ:'G', ğ:'g', Ü:'U', ü:'U', Ö:'O', ö:'O', Ç:'C', ç:'C' }[ch] || ch))
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return str
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch => ({ İ:'I', I:'I', ı:'i', Ş:'S', ş:'s', Ğ:'G', ğ:'g', Ü:'U', ü:'U', Ö:'O', ö:'O', Ç:'C', ç:'C' }[ch] || ch))
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
function canonicalName(s = '') {
  return trFold(removeSuffixes(stripBrackets(s)));
}

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS poi_match (
      key         TEXT PRIMARY KEY,          -- canonical(name)@lat5,lon5   (seed anahtar)
      name_norm   TEXT,                      -- normalize edilmiş ad
      lat5        REAL,                      -- seed lat (round5)
      lon5        REAL,                      -- seed lon (round5)
      city        TEXT,                      -- opsiyonel

      place_id    TEXT NOT NULL,             -- Google place_id
      rating      REAL,                      -- opsiyonel
      hours_json  TEXT,                      -- JSON string (açılış saatleri)
      g_lat5      REAL,                      -- Google lat (round5)
      g_lon5      REAL,                      -- Google lon (round5)

      item_id     TEXT,                      -- ⬅️ benzersiz seed id/osm_id (client’ın gönderdiği)
      created_ms  INTEGER,
      updated_ms  INTEGER
    );
  `);

  // Yeni kolonlar için non-destructive migration
  const cols = db.prepare(`PRAGMA table_info(poi_match)`).all();
  const names = cols.map(c => c.name);
  const addCol = (n, defSql) => {
    if (!names.includes(n)) {
      db.exec(`ALTER TABLE poi_match ADD COLUMN ${n} ${defSql}`);
      console.log(`[matchDB] migrated → added column: ${n}`);
    }
  };
  addCol('name_norm', 'TEXT');
  addCol('lat5', 'REAL');
  addCol('lon5', 'REAL');
  addCol('city', 'TEXT');
  addCol('g_lat5', 'REAL');
  addCol('g_lon5', 'REAL');
  addCol('item_id', 'TEXT');
  addCol('created_ms', 'INTEGER');
  addCol('updated_ms', 'INTEGER');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_poi_match_item_id ON poi_match(item_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_poi_match_name_norm ON poi_match(name_norm)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_poi_match_lat_lon ON poi_match(lat5, lon5)`);
}
ensureSchema();

// ---- core ops ----

// Tek bir row oluşturucu
function toRow({ name, lat, lon, city, place_id, rating, hours, g_lat, g_lon, item_id }) {
  const lat5 = round5(lat);
  const lon5 = round5(lon);
  const g_lat5 = Number.isFinite(Number(g_lat)) ? round5(g_lat) : null;
  const g_lon5 = Number.isFinite(Number(g_lon)) ? round5(g_lon) : null;
  const name_norm = canonicalName(name || '');
  const key = `${name_norm}@${lat5},${lon5}`;
  return {
    key,
    name_norm,
    lat5,
    lon5,
    city: city || null,
    place_id,
    rating: (rating != null ? Number(rating) : null),
    hours_json: hours ? JSON.stringify(hours) : null,
    g_lat5,
    g_lon5,
    item_id: item_id || null,
    created_ms: Date.now(),
    updated_ms: Date.now(),
  };
}

// Batch select: key’e göre (ayrı olarak item_id ile de kontrol eder)
function getManyByKey(keys) {
  if (!Array.isArray(keys) || !keys.length) return [];
  const stmt = db.prepare(`SELECT * FROM poi_match WHERE key IN (${keys.map(() => '?').join(',')})`);
  return stmt.all(keys);
}

// Batch select: item_id’ye göre
function getManyByItemId(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return [];
  const stmt = db.prepare(`SELECT * FROM poi_match WHERE item_id IN (${uniq.map(() => '?').join(',')})`);
  return stmt.all(uniq);
}

// Batch upsert
function upsertMany(rows) {
  const insert = db.prepare(`
    INSERT INTO poi_match
    (key, name_norm, lat5, lon5, city, place_id, rating, hours_json, g_lat5, g_lon5, item_id, created_ms, updated_ms)
    VALUES (@key, @name_norm, @lat5, @lon5, @city, @place_id, @rating, @hours_json, @g_lat5, @g_lon5, @item_id, @created_ms, @updated_ms)
    ON CONFLICT(key) DO UPDATE SET
      place_id=excluded.place_id,
      rating=excluded.rating,
      hours_json=excluded.hours_json,
      g_lat5=excluded.g_lat5,
      g_lon5=excluded.g_lon5,
      city=COALESCE(excluded.city, poi_match.city),
      item_id=COALESCE(excluded.item_id, poi_match.item_id),
      updated_ms=excluded.updated_ms
  `);
  const trx = db.transaction((arr) => {
    let n = 0;
    for (const r of arr) {
      insert.run(r);
      n++;
    }
    return n;
  });
  return trx(rows);
}

module.exports = {
  db,
  round5,
  canonicalName,
  toRow,
  getManyByKey,
  getManyByItemId,
  upsertMany,
};
