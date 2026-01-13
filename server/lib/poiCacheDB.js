// server/lib/poiCacheDB.js
const fs = require('fs');
const path = require('path');

let sqlite3;
try { sqlite3 = require('sqlite3'); } catch (e) {
  throw new Error('sqlite3_missing: npm i sqlite3');
}

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'poi_cache.db');

let _db = null;

function openDb() {
  if (_db) return _db;
  _db = new sqlite3.Database(DB_PATH);
  _db.exec('PRAGMA journal_mode=WAL;');
  _db.exec('PRAGMA synchronous=NORMAL;');
  _db.exec('PRAGMA temp_store=MEMORY;');
  initSchema(_db);
  return _db;
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function initSchema(db) {
  // places: tekil yer (place_id)
  await run(db, `
    CREATE TABLE IF NOT EXISTS poi_places (
      place_id TEXT PRIMARY KEY,
      name TEXT,
      name_norm TEXT,
      address TEXT,
      lat REAL,
      lon REAL,
      rating REAL,
      user_ratings_total INTEGER,
      price_level INTEGER,
      types_json TEXT,
      source TEXT,     -- google / suggest / local
      provider TEXT,   -- autocomplete / search / etc.
      country TEXT,    -- ISO2 (TR/PL)
      updated_ms INTEGER,
      created_ms INTEGER
    );
  `);

  // place ↔ city mapping: aynı place birden fazla şehir query’sinde görünebilir
  await run(db, `
    CREATE TABLE IF NOT EXISTS poi_place_city (
      place_id TEXT NOT NULL,
      city TEXT NOT NULL,
      country TEXT,
      first_seen_ms INTEGER,
      last_seen_ms INTEGER,
      hit_count INTEGER DEFAULT 1,
      PRIMARY KEY (place_id, city),
      FOREIGN KEY(place_id) REFERENCES poi_places(place_id) ON DELETE CASCADE
    );
  `);

  // indexler
  await run(db, `CREATE INDEX IF NOT EXISTS idx_places_city_country ON poi_place_city (city, country, last_seen_ms);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_places_name_norm ON poi_places (name_norm);`);
  await run(db, `CREATE INDEX IF NOT EXISTS idx_places_updated ON poi_places (updated_ms);`);
}

function trFold(s = '') {
  const map = {
    'İ': 'I', 'I': 'I', 'ı': 'i',
    'Ş': 'S', 'ş': 's',
    'Ğ': 'G', 'ğ': 'g',
    'Ü': 'U', 'ü': 'U',
    'Ö': 'O', 'ö': 'O',
    'Ç': 'C', 'ç': 'C',
  };
  const str = String(s || '');
  try {
    return str
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch => map[ch] || ch)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return str
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch => map[ch] || ch)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}

function safeJson(v) {
  try { return JSON.stringify(v ?? []); } catch { return '[]'; }
}

function finiteNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function finiteInt(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : null;
}

/**
 * upsertPlaces(items, meta)
 * items: [{ place_id, name, address, lat, lon, rating, user_ratings_total, price_level, types }]
 * meta : { city, country, source, provider }
 */
async function upsertPlaces(items = [], meta = {}) {
  const db = openDb();

  const city = String(meta.city || '').trim();
  const country = String(meta.country || '').trim() || null;
  const source = String(meta.source || '').trim() || null;
  const provider = String(meta.provider || '').trim() || null;

  const now = Date.now();
  const valid = (items || []).filter(x => x && x.place_id);

  if (!valid.length) return { upserted: 0, mapped: 0 };

  // tx
  await run(db, 'BEGIN IMMEDIATE;');

  let upserted = 0;
  let mapped = 0;

  try {
    for (const r of valid) {
      const place_id = String(r.place_id);

      const name = String(r.name || '');
      const name_norm = trFold(name);
      const address = String(r.address || '');
      const lat = finiteNum(r.lat);
      const lon = finiteNum(r.lon);
      const rating = r.rating == null ? null : finiteNum(r.rating);
      const user_ratings_total = r.user_ratings_total == null ? null : finiteInt(r.user_ratings_total);
      const price_level = r.price_level == null ? null : finiteInt(r.price_level);
      const types_json = safeJson(Array.isArray(r.types) ? r.types : []);

      // place upsert
      await run(db, `
        INSERT INTO poi_places (
          place_id, name, name_norm, address, lat, lon,
          rating, user_ratings_total, price_level, types_json,
          source, provider, country, updated_ms, created_ms
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(place_id) DO UPDATE SET
          name=excluded.name,
          name_norm=excluded.name_norm,
          address=COALESCE(excluded.address, poi_places.address),
          lat=COALESCE(excluded.lat, poi_places.lat),
          lon=COALESCE(excluded.lon, poi_places.lon),
          rating=COALESCE(excluded.rating, poi_places.rating),
          user_ratings_total=COALESCE(excluded.user_ratings_total, poi_places.user_ratings_total),
          price_level=COALESCE(excluded.price_level, poi_places.price_level),
          types_json=CASE
            WHEN excluded.types_json IS NOT NULL AND excluded.types_json != '[]' THEN excluded.types_json
            ELSE poi_places.types_json
          END,
          source=COALESCE(excluded.source, poi_places.source),
          provider=COALESCE(excluded.provider, poi_places.provider),
          country=COALESCE(excluded.country, poi_places.country),
          updated_ms=excluded.updated_ms
      `, [
        place_id, name, name_norm, address, lat, lon,
        rating, user_ratings_total, price_level, types_json,
        source, provider, country, now, now,
      ]);

      upserted += 1;

      // city mapping
      if (city) {
        await run(db, `
          INSERT INTO poi_place_city (place_id, city, country, first_seen_ms, last_seen_ms, hit_count)
          VALUES (?,?,?,?,?,1)
          ON CONFLICT(place_id, city) DO UPDATE SET
            last_seen_ms=excluded.last_seen_ms,
            country=COALESCE(excluded.country, poi_place_city.country),
            hit_count=poi_place_city.hit_count + 1
        `, [place_id, city, country, now, now]);

        mapped += 1;
      }
    }

    await run(db, 'COMMIT;');
    return { upserted, mapped };
  } catch (e) {
    try { await run(db, 'ROLLBACK;'); } catch {}
    throw e;
  }
}

/**
 * searchCache({ q, city, country, limit, category })
 * - q: text
 * - city/country: optional filter
 * - category: optional (restaurants/cafes/bars/museums/parks/sights)
 *   -> google types üzerinden kaba filtre
 */
const CAT_TO_TYPES = {
  restaurants: ['restaurant', 'food', 'meal_takeaway', 'meal_delivery'],
  cafes: ['cafe', 'bakery'],
  bars: ['bar', 'night_club'],
  museums: ['museum'],
  parks: ['park'],
  sights: ['tourist_attraction', 'point_of_interest'],
};

function buildTypeWhere(category) {
  const types = CAT_TO_TYPES[String(category || '')] || null;
  if (!types) return { clause: '', args: [] };
  // types_json LIKE '%"museum"%' gibi
  const ors = types.map(() => `p.types_json LIKE ?`);
  const args = types.map(t => `%"${t}"%`);
  return { clause: ` AND (${ors.join(' OR ')})`, args };
}

async function searchCache({ q, city, country, limit = 12, category } = {}) {
  const db = openDb();
  const qTrim = String(q || '').trim();
  if (qTrim.length < 2) return [];

  const qNorm = trFold(qTrim);
  const lim = Math.max(1, Math.min(50, Number(limit) || 12));

  const where = [];
  const args = [];

  // name_norm prefix match
  where.push(`p.name_norm LIKE ?`);
  args.push(`${qNorm}%`);

  // city filter
  let joinCity = false;
  if (city && String(city).trim()) {
    joinCity = true;
    where.push(`pc.city = ?`);
    args.push(String(city).trim());
  }

  // country filter (hem places hem mapping)
  if (country && String(country).trim()) {
    const cc = String(country).trim();
    if (joinCity) {
      where.push(`(pc.country = ? OR p.country = ?)`);
      args.push(cc, cc);
    } else {
      where.push(`(p.country = ?)`);
      args.push(cc);
    }
  }

  const typeFilter = buildTypeWhere(category);

  const sql = `
    SELECT
      p.place_id, p.name, p.address, p.lat, p.lon,
      p.rating, p.user_ratings_total, p.price_level,
      p.types_json, p.source, p.provider,
      p.country, p.updated_ms
    FROM poi_places p
    ${joinCity ? 'JOIN poi_place_city pc ON pc.place_id = p.place_id' : ''}
    WHERE ${where.join(' AND ')}
    ${typeFilter.clause}
    ORDER BY p.user_ratings_total DESC, p.rating DESC, p.updated_ms DESC
    LIMIT ${lim}
  `;

  const rows = await all(db, sql, [...args, ...typeFilter.args]);

  return rows.map(r => ({
    source: r.source || 'cache',
    provider: r.provider || 'cache',
    place_id: r.place_id,
    name: r.name,
    address: r.address || '',
    city: city || '',
    lat: r.lat,
    lon: r.lon,
    rating: r.rating,
    user_ratings_total: r.user_ratings_total,
    price_level: r.price_level,
    types: (() => { try { return JSON.parse(r.types_json || '[]'); } catch { return []; } })(),
    country: r.country || null,
    updated_ms: r.updated_ms || null,
  }));
}

module.exports = {
  DB_PATH,
  openDb,
  upsertPlaces,
  searchCache,
};
