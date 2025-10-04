// app/lib/poiLocal.js
import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
import { Platform } from 'react-native';

const SHARDS = {
  TR: () => require('../../assets/poi_TR.db'),
};

// ---- internal caches / locks ----
const dbCache = new Map();           // country -> db instance
const initLock = new Map();          // country -> Promise in-flight
const validated = new Set();         // country already validated

async function ensureDir(p) {
  try { await FileSystem.makeDirectoryAsync(p, { intermediates: true }); } catch {}
}

async function fileSize(uri) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? (info.size ?? 0) : 0;
  } catch { return 0; }
}

async function copyAssetTo(uriFrom, uriTo) {
  try { await FileSystem.deleteAsync(uriTo, { idempotent: true }); } catch {}
  await FileSystem.copyAsync({ from: uriFrom, to: uriTo });
}

async function ensureShard(country = 'TR') {
  const mod = SHARDS[country]?.();
  if (!mod) return null;

  const asset = Asset.fromModule(mod);
  await asset.downloadAsync(); // paketten cihaza indir

  const sqliteDir = FileSystem.documentDirectory + 'SQLite/';
  await ensureDir(sqliteDir);

  const dest = sqliteDir + `poi_${country}.db`;

  // yoksa ya da çok küçükse -> kopyala
  let sz = await fileSize(dest);
  if (sz < 1024) {
    await copyAssetTo(asset.localUri || asset.uri, dest);
    sz = await fileSize(dest);
  }

  if (__DEV__) console.log(`[poiLocal] shard → ${dest} (${Math.round(sz/1024)} KB)`);
  return dest;
}

async function loadSQLite() {
  try {
    const SQLite = await import('expo-sqlite').catch(() => null);
    return SQLite && Object.keys(SQLite).length ? SQLite : null;
  } catch { return null; }
}

function hasAsyncAPI(SQLite) { return !!SQLite?.openDatabaseAsync; }

async function validatePoiTable(db) {
  const sql = `SELECT name FROM sqlite_master WHERE type='table' AND name='poi'`;
  try {
    if (typeof db.getAllAsync === 'function') {
      const rows = await db.getAllAsync(sql);
      return Array.isArray(rows) && rows.length > 0;
    }
    // legacy
    return await new Promise((resolve) => {
      db.readTransaction((tx) => {
        tx.executeSql(sql, [], (_, rs) => resolve((rs?.rows?._array || []).length > 0),
          () => { resolve(false); return false; });
      });
    });
  } catch { return false; }
}

async function reallyOpen(SQLite, country) {
  // her zaman shard hazırla (kopya)
  await ensureShard(country);
  const name = `poi_${country}.db`;
  const db = hasAsyncAPI(SQLite)
    ? await SQLite.openDatabaseAsync(name)
    : SQLite.openDatabase(name);
  return db;
}

/* --------------------- small SQL helpers (exec/select/insert) --------------------- */
async function tableCount(db, table) {
  try {
    const rows = await runSelect(db, `SELECT COUNT(*) AS n FROM ${table}`, []);
    return Number(rows?.[0]?.n || 0);
  } catch { return 0; }
}

async function hasTable(db, name) {
  try {
    const rows = await runSelect(db,
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [name]);
    return (rows?.length || 0) > 0;
  } catch { return false; }
}

async function execSQL(db, sql) {
  const parts = String(sql).split(';').map(s => s.trim()).filter(Boolean);
  if (typeof db.execAsync === 'function') {
    for (const p of parts) await db.execAsync(p + ';');
    return;
  }
  await new Promise((resolve) => {
    db.transaction((tx) => {
      for (const p of parts) {
        tx.executeSql(p + ';', [], () => {}, () => { return false; });
      }
    }, () => resolve(), () => resolve());
  });
}

async function runSelect(db, sql, args) {
  if (typeof db.getAllAsync === 'function') {
    try {
      return await db.getAllAsync(sql, args);
    } catch (e) {
      if (__DEV__) console.warn('[poiLocal] getAllAsync failed, retrying once:', e?.message || e);
      await new Promise(r => setTimeout(r, 50));
      try {
        return await db.getAllAsync(sql, args);
      } catch (e2) {
        if (__DEV__) console.warn('[poiLocal] getAllAsync second fail:', e2?.message || e2);
        return [];
      }
    }
  }
  return await new Promise((resolve) => {
    db.readTransaction((tx) => {
      tx.executeSql(
        sql, args,
        (_, rs) => resolve(rs?.rows?._array || []),
        () => { resolve([]); return false; }
      );
    });
  });
}

async function runInsert(db, sql, args) {
  if (typeof db.runAsync === 'function') {
    try { await db.runAsync(sql, args); return true; }
    catch { return false; }
  }
  return await new Promise((resolve) => {
    db.transaction((tx) => {
      tx.executeSql(sql, args, () => resolve(true), () => { resolve(false); return false; });
    });
  });
}

/* ------------------------------- normalize helpers ------------------------------- */
function normalizeText(s = '') {
  try {
    return s.normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/[İIı]/g,'i')
      .replace(/[Şş]/g,'s')
      .replace(/[Ğğ]/g,'g')
      .replace(/[Üü]/g,'u')
      .replace(/[Öö]/g,'o')
      .replace(/[Çç]/g,'c')
      .toLowerCase().trim();
  } catch { return String(s || '').toLowerCase().trim(); }
}

/* ------------------------- ensure user table (overlay) ------------------------- */
async function ensureUserTable(db) {
  const sql = `
    CREATE TABLE IF NOT EXISTS poi_user (
      id        TEXT PRIMARY KEY,
      country   TEXT NOT NULL,
      city      TEXT,
      category  TEXT,
      name      TEXT,
      nameNorm  TEXT,
      lat       REAL,
      lon       REAL,
      address   TEXT,
      source    TEXT DEFAULT 'google',
      place_id  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_poi_user_city_cat ON poi_user(city, category);
    CREATE INDEX IF NOT EXISTS idx_poi_user_nameNorm ON poi_user(nameNorm);
  `;
  await execSQL(db, sql);
}

/**
 * Tek giriş noktası: openPoiDb
 */
export async function openPoiDb(country = 'TR') {
  if (Platform.OS === 'web') return null;

  if (dbCache.has(country)) return dbCache.get(country);
  if (initLock.has(country)) return initLock.get(country);

  const p = (async () => {
    const SQLite = await loadSQLite();
    if (!SQLite) return null;

    // İlk açılış
    let db = await reallyOpen(SQLite, country);

    // Daha önce doğrulandıysa direkt dön
    if (validated.has(country)) {
      dbCache.set(country, db);
      return db;
    }

    // Tablonun varlığını kontrol et
    let ok = await validatePoiTable(db);
    if (!ok) {
      const sqliteDir = FileSystem.documentDirectory + 'SQLite/';
      const dest = sqliteDir + `poi_${country}.db`;
      try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch {}
      await ensureShard(country);
      db = await reallyOpen(SQLite, country);
      ok = await validatePoiTable(db);
      if (__DEV__) console.log('[poiLocal] re-copy & reopen. poi table ok:', ok);
    }
    try {
      const cnt = await tableCount(db, 'poi');
      if (!Number.isFinite(cnt) || cnt === 0) {
        if (__DEV__) console.warn('[poiLocal] seed looks empty → re-copying shard');
        const sqliteDir = FileSystem.documentDirectory + 'SQLite/';
        const dest = sqliteDir + `poi_${country}.db`;
        try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch {}
        await ensureShard(country);
        db = await reallyOpen(SQLite, country);
      }
    } catch {}

    // overlay tabloyu garantiye al
    await ensureUserTable(db);

    validated.add(country);
    dbCache.set(country, db);
    return db;
  })();

  initLock.set(country, p);
  const result = await p.finally(() => initLock.delete(country));
  return result;
}

/* ----------------------- PUBLIC: query (seed) ----------------------- */
export async function queryPoi({ country = 'TR', city, category, q, limit = 50 }) {
  const db = await openPoiDb(country);
  if (!db) return { rows: [] };

  const where = [], args = [];
  const cityTrim = String(city || '').trim();
  if (cityTrim)   { where.push('city LIKE ? COLLATE NOCASE'); args.push(`%${cityTrim}%`); }
  if (category)   { where.push('category = ?');  args.push(category); }
  if (q && q.trim().length >= 2) {
    where.push('nameNorm LIKE ?'); args.push(`%${normalizeText(q)}%`);
  }

  const sql = `
    SELECT id,country,city,category,name,lat,lon,address
    FROM poi
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    LIMIT ${Number(limit) || 50}
  `;

  const arr = await runSelect(db, sql, args);
  return { rows: arr || [] };
}

/* ----------------------- PUBLIC: query (seed + user) ----------------------- */
export async function queryPoiWithUser({ country = 'TR', city, category, q, limit = 50 }) {
  const db = await openPoiDb(country);
  if (!db) return { rows: [] };

  const lim = Number(limit) || 50;

  // ortak where’ler (seed)
  const seedWhere = [], seedArgs = [];
  const cityTrim = String(city || '').trim();

  if (cityTrim)   { seedWhere.push('city LIKE ? COLLATE NOCASE'); seedArgs.push(`%${cityTrim}%`); }
  if (category)   { seedWhere.push('category = ?');  seedArgs.push(category); }
  if (q && q.trim().length >= 2) {
    seedWhere.push('nameNorm LIKE ?');
    seedArgs.push(`%${normalizeText(q)}%`);
  }

  // kullanıcı tablosu varsa ayrı where/args
  const hasUser = await (async () => {
    try { return await runSelect(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='poi_user'`, []).then(r => (r?.length ?? 0) > 0); }
    catch { return false; }
  })();

  const userWhere = [], userArgs = [];
  if (hasUser) {
    if (cityTrim)   { userWhere.push('city LIKE ? COLLATE NOCASE'); userArgs.push(`%${cityTrim}%`); }
    if (category)   { userWhere.push('category = ?');  userArgs.push(category); }
    if (q && q.trim().length >= 2) {
      userWhere.push('nameNorm LIKE ?');
      userArgs.push(`%${normalizeText(q)}%`);
    }
  }

  // 1) seed çek
  const seedSQL = `
    SELECT id,country,city,category,name,lat,lon,address,NULL AS place_id,'local' AS source
    FROM poi
    ${seedWhere.length ? 'WHERE ' + seedWhere.join(' AND ') : ''}
    LIMIT ${lim}
  `;
  const seedRows = await runSelect(db, seedSQL, seedArgs);

  // 2) user çek (varsa)
  let userRows = [];
  if (hasUser) {
    const userSQL = `
      SELECT id,country,city,category,name,lat,lon,address,place_id,'google' AS source
      FROM poi_user
      ${userWhere.length ? 'WHERE ' + userWhere.join(' AND ') : ''}
      LIMIT ${lim}
    `;
    userRows = await runSelect(db, userSQL, userArgs);
  }

  const rows = [...seedRows, ...userRows].slice(0, lim);
  return { rows: rows || [] };
}

/* ----------------------- PUBLIC: add user POI (Google) ----------------------- */
export async function addUserPoi({
  country = 'TR',
  city,
  category = 'sights',
  name,
  lat,
  lon,
  address = '',
  place_id,
}) {
  const db = await openPoiDb(country);
  if (!db) return false;

  if (!name || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return false;

  const rec = {
    id: place_id ? `pid:${place_id}` : `u:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    country,
    city: city || null,
    category,
    name,
    nameNorm: normalizeText(`${name} ${address}`),
    lat: Number(lat),
    lon: Number(lon),
    address: address || '',
    place_id: place_id || null,
  };

  const sql = `
    INSERT OR REPLACE INTO poi_user
    (id,country,city,category,name,nameNorm,lat,lon,address,source,place_id)
    VALUES (?,?,?,?,?,?,?,?,?,'google',?)
  `;
  const args = [
    rec.id, rec.country, rec.city, rec.category, rec.name, rec.nameNorm,
    rec.lat, rec.lon, rec.address, rec.place_id
  ];

  const ok = await runInsert(db, sql, args);
  if (__DEV__ && ok) console.log('[poiLocal] addUserPoi OK:', rec.name, rec.city || '');
  return ok;
}

export { runSelect };

/* ----------------------- DEBUG helpers ----------------------- */
export async function __debugDump() {
  const db = await openPoiDb('TR');
  const a = await runSelect(db, 'SELECT COUNT(*) AS n FROM poi', []);
  let b = [{ n: 0 }];
  try { b = await runSelect(db, 'SELECT COUNT(*) AS n FROM poi_user', []); } catch {}
  console.log('[DEBUG] seed count=', a?.[0]?.n, ' user count=', b?.[0]?.n);
}

/** KATEGORİ ve örnek satırları görmek için derin dump */
export async function __debugDumpDeep(limit = 5) {
  const db = await openPoiDb('TR');
  const cats = await runSelect(db, 'SELECT category, COUNT(*) AS n FROM poi GROUP BY category ORDER BY n DESC', []);
  const samples = await runSelect(db, `SELECT id,city,category,name,lat,lon,address FROM poi LIMIT ${Number(limit)||5}`, []);
  console.log('[DEBUG:cats]', cats);
  console.log('[DEBUG:samples]', samples);
}
