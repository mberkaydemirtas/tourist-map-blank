// server/lib/suggestDB.js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'poi_suggest.db');
const db = new Database(DB_PATH);

// Performans + çoklu okuma/yazma için iyi pratik
try { db.pragma('journal_mode = WAL'); } catch {}
try { db.pragma('synchronous = NORMAL'); } catch {}

// ---- Helpers: TR fold / normalize ----
function trFold(str = '') {
  const s = String(str || '');
  try {
    return s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch =>
        ({ İ:'I', I:'I', ı:'i', Ş:'S', ş:'s', Ğ:'G', ğ:'g', Ü:'U', ü:'u', Ö:'O', ö:'o', Ç:'C', ç:'c' }[ch] || ch)
      )
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return s
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch =>
        ({ İ:'I', I:'I', ı:'i', Ş:'S', ş:'s', Ğ:'G', ğ:'g', Ü:'U', ü:'u', Ö:'O', ö:'o', Ç:'C', ç:'c' }[ch] || ch)
      )
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
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
function normName(s = '') {
  return trFold(removeSuffixes(stripBrackets(s)));
}

/**
 * City normalization with aliases.
 * Amaç: Warsaw / Warszawa / Varşova -> city_norm = "warszawa"
 * Böylece TripListQuestion city'yi "Warsaw" yollasa bile,
 * suggest.js city=Warszawa ile sorgulayınca eşleşir.
 */
function normCity(s = '') {
  const raw = String(s || '').trim();
  if (!raw) return '';

  const folded = trFold(raw);

  // Alias map (folded haliyle kıyaslıyoruz)
  const ALIAS = {
    // Warsaw variations
    'warsaw': 'warszawa',
    'warszawa': 'warszawa',
    'varsova': 'warszawa',   // Varşova -> trFold => varsova
    // İstersen buraya başka şehir aliasları da ekleriz
  };

  return ALIAS[folded] || folded;
}

function round5(x) { return Math.round(Number(x) * 1e5) / 1e5; }

// ---- Schema ----
db.exec(`
CREATE TABLE IF NOT EXISTS poi_suggest (
  place_id TEXT PRIMARY KEY,
  name TEXT,
  name_norm TEXT,
  address TEXT,
  city TEXT,
  lat5 REAL,
  lon5 REAL,
  rating REAL,
  user_ratings_total INTEGER,
  price_level INTEGER,
  types TEXT,
  source TEXT,     -- 'google' | 'cache'
  provider TEXT,   -- 'autocomplete' | 'search'
  hits INTEGER DEFAULT 0,
  created_ms INTEGER,
  updated_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_poi_suggest_city_name ON poi_suggest (city, name_norm);
CREATE INDEX IF NOT EXISTS idx_poi_suggest_updated ON poi_suggest (updated_ms);
`);

// --- Lightweight migration: add city_norm if missing ---
function ensureColumn(table, col, typeSql) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const has = cols.some(c => c.name === col);
  if (!has) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${typeSql};`);
  }
}
try {
  ensureColumn('poi_suggest', 'city_norm', 'TEXT');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_poi_suggest_citynorm_name ON poi_suggest (city_norm, name_norm);`);
} catch (e) {
  console.warn('[suggestDB] migration warn:', e?.message || e);
}

// ---- CRUD ----
const upsertStmt = db.prepare(`
INSERT INTO poi_suggest (place_id, name, name_norm, address, city, city_norm, lat5, lon5, rating,
  user_ratings_total, price_level, types, source, provider, hits, created_ms, updated_ms)
VALUES (@place_id, @name, @name_norm, @address, @city, @city_norm, @lat5, @lon5, @rating,
  @user_ratings_total, @price_level, @types, @source, @provider, @hits, @created_ms, @updated_ms)
ON CONFLICT(place_id) DO UPDATE SET
  name=excluded.name,
  name_norm=excluded.name_norm,
  address=excluded.address,
  city=excluded.city,
  city_norm=excluded.city_norm,
  lat5=COALESCE(excluded.lat5, lat5),
  lon5=COALESCE(excluded.lon5, lon5),
  rating=COALESCE(excluded.rating, rating),
  user_ratings_total=COALESCE(excluded.user_ratings_total, user_ratings_total),
  price_level=COALESCE(excluded.price_level, price_level),
  types=COALESCE(excluded.types, types),
  source=excluded.source,
  provider=excluded.provider,
  updated_ms=excluded.updated_ms
`);

const touchHitsStmt = db.prepare(`
UPDATE poi_suggest SET hits = COALESCE(hits,0) + 1, updated_ms = @now WHERE place_id = @place_id
`);

function upsertSuggests(arr = [], { city = '', provider = 'autocomplete', source = 'google' } = {}) {
  const now = Date.now();
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const name = r?.name || r?.title || '—';
      const nm = normName(name);

      const rawCity =
        (r.city && String(r.city).trim())
          ? String(r.city).trim()
          : (city && String(city).trim())
            ? String(city).trim()
            : '';

      const obj = {
        place_id: String(r.place_id || '').trim(),
        name,
        name_norm: nm,
        address: r.address || r.formatted_address || '',
        city: rawCity,
        city_norm: normCity(rawCity),
        lat5: Number.isFinite(Number(r.lat)) ? round5(r.lat) : null,
        lon5: Number.isFinite(Number(r.lon)) ? round5(r.lon) : null,
        rating: Number.isFinite(Number(r.rating)) ? Number(r.rating) : null,
        user_ratings_total: Number.isFinite(Number(r.user_ratings_total)) ? Number(r.user_ratings_total) : null,
        price_level: Number.isFinite(Number(r.price_level)) ? Number(r.price_level) : null,
        types: Array.isArray(r.types) ? JSON.stringify(r.types) : (r.types || null),
        source,
        provider,
        hits: Number.isFinite(Number(r.hits)) ? Number(r.hits) : 0,
        created_ms: now,
        updated_ms: now,
      };
      if (!obj.place_id) continue;
      upsertStmt.run(obj);
    }
  });
  tx(arr);
}

function searchSuggests({ q, city = '', limit = 12 }) {
  const nm = normName(String(q || ''));
  if (!nm) return [];
  const like = `${nm}%`;

  const rawCity = (city || '').trim();
  const cityNorm = normCity(rawCity);

  const stmt = db.prepare(`
    SELECT place_id, name, address, city, lat5 AS lat, lon5 AS lon,
           rating, user_ratings_total, price_level, types, source, provider, hits
    FROM poi_suggest
    WHERE (
      (@city = '' AND @cityNorm = '')
      OR city = @city
      OR city_norm = @cityNorm
      OR IFNULL(city,'') = ''
    )
      AND name_norm LIKE @like
    ORDER BY hits DESC, user_ratings_total DESC, rating DESC, name ASC
    LIMIT @limit
  `);

  return stmt.all({
    city: rawCity,
    cityNorm,
    like,
    limit: Number(limit) || 12
  });
}

function touchHits(placeIds = []) {
  const now = Date.now();
  const tx = db.transaction((ids) => {
    for (const id of ids) {
      touchHitsStmt.run({ now, place_id: id });
    }
  });
  tx(placeIds.filter(Boolean));
}

module.exports = {
  upsertSuggests,
  searchSuggests,
  touchHits,
  normName, trFold, normCity
};
