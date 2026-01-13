// app/lib/poiLocal.js
import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
import { Platform } from 'react-native';

const SHARDS = {
  TR: () => require('../../assets/poi_TR.db'),
  PL: () => require('../../assets/poi_PL.db'), // boş db (poi tablosu var) — yoksa da şemayı kuracağız
};

// ---- internal caches / locks ----
const dbCache = new Map();           // country -> db instance
const initLock = new Map();          // country -> Promise in-flight
const validated = new Set();         // country already validated

async function ensureDir(p) {
  try { await FileSystem.makeDirectoryAsync(p, { intermediates: true }); } catch {}
}

async function fileInfo(uri) {
  try { return await FileSystem.getInfoAsync(uri); } catch { return { exists: false, size: 0 }; }
}

async function fileSize(uri) {
  const info = await fileInfo(uri);
  return info.exists ? (info.size ?? 0) : 0;
}

function isFileUri(u = '') { return typeof u === 'string' && u.startsWith('file:'); }
function isAssetUri(u = '') { return typeof u === 'string' && (u.startsWith('asset:') || u.startsWith('http')); }

async function safeCopyToDest(srcUri, destUri) {
  // Önce hedefi temizle
  try { await FileSystem.deleteAsync(destUri, { idempotent: true }); } catch {}

  // Bazı Android durumlarında Asset URI copyAsync ile bozuk/boş kopyalanabiliyor.
  // Bu yüzden:
  // - file:// ise copyAsync
  // - asset:// / http(s):// ise downloadAsync fallback
  try {
    if (isFileUri(srcUri)) {
      await FileSystem.copyAsync({ from: srcUri, to: destUri });
    } else {
      // asset:// veya http gibi şeylerde downloadAsync daha güvenilir
      await FileSystem.downloadAsync(srcUri, destUri);
    }
  } catch (e) {
    // ilk deneme başarısızsa tersini dene
    try {
      if (!isFileUri(srcUri)) {
        await FileSystem.copyAsync({ from: srcUri, to: destUri });
      } else {
        await FileSystem.downloadAsync(srcUri, destUri);
      }
    } catch (e2) {
      if (__DEV__) console.warn('[poiLocal] copy failed:', e2?.message || e2);
      throw e2;
    }
  }
}

async function loadSQLite() {
  try {
    const SQLite = await import('expo-sqlite').catch(() => null);
    return SQLite && Object.keys(SQLite).length ? SQLite : null;
  } catch { return null; }
}

function hasAsyncAPI(SQLite) { return !!SQLite?.openDatabaseAsync; }

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
      await new Promise(r => setTimeout(r, 60));
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

async function validatePoiTable(db) {
  try {
    const rows = await runSelect(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='poi'`, []);
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}

async function ensurePoiSchema(db) {
  // “seed” tablo (poi) — TR seed dolu, PL boş olabilir ama tablo olmalı
  const sql = `
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
    CREATE INDEX IF NOT EXISTS idx_poi_city_cat ON poi(city, category);
    CREATE INDEX IF NOT EXISTS idx_poi_nameNorm ON poi(nameNorm);
  `;
  await execSQL(db, sql);
}

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

async function ensureShardFile(country = 'TR') {
  const sqliteDir = FileSystem.documentDirectory + 'SQLite/';
  await ensureDir(sqliteDir);

  const dest = sqliteDir + `poi_${country}.db`;

  // ✅ FIX: Dosya varsa (boyutu küçük olsa bile) yeniden kopyalama!
  // PL shard boş olduğundan <1024 olabiliyor ve eski mantık her açılışta resetliyordu.
  const info = await fileInfo(dest);
  if (info.exists) {
    if (__DEV__) console.log(`[poiLocal] shard exists → ${dest} (${Math.round((info.size || 0) / 1024)} KB)`);
    return dest;
  }

  const mod = SHARDS[country]?.();
  if (!mod) {
    // shard yok → boş db dosyası oluşturulacak (sqlite open + schema)
    if (__DEV__) console.log(`[poiLocal] no asset shard for ${country} → will create empty on open`);
    return dest;
  }

  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();

  const srcUri = asset.localUri || asset.uri; // localUri bazen null olabiliyor
  await safeCopyToDest(srcUri, dest);

  const newSz = await fileSize(dest);
  if (__DEV__) console.log(`[poiLocal] shard → ${dest} (${Math.round(newSz / 1024)} KB)`);
  return dest;
}

async function reallyOpen(SQLite, country) {
  // 1) dosya yolunu garanti et
  await ensureShardFile(country);

  // 2) expo-sqlite isimle açıyor (documentDirectory/SQLite altında arar)
  const name = `poi_${country}.db`;
  const db = hasAsyncAPI(SQLite)
    ? await SQLite.openDatabaseAsync(name)
    : SQLite.openDatabase(name);
  return db;
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

async function tableCount(db, table) {
  try {
    const rows = await runSelect(db, `SELECT COUNT(*) AS n FROM ${table}`, []);
    return Number(rows?.[0]?.n || 0);
  } catch { return 0; }
}

async function nukeShard(country) {
  const sqliteDir = FileSystem.documentDirectory + 'SQLite/';
  const dest = sqliteDir + `poi_${country}.db`;
  try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch {}
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

    // 1) poi tablosu var mı?
    let ok = await validatePoiTable(db);

    // 2) yoksa: shard’ı tamamen sil → assets’ten tekrar kopyala → yeniden aç → yine yoksa schema kur
    if (!ok) {
      if (__DEV__) console.warn('[poiLocal] poi table missing → re-copy/rebuild', { country });

      await nukeShard(country);
      await ensureShardFile(country);
      db = await reallyOpen(SQLite, country);
      ok = await validatePoiTable(db);

      if (!ok) {
        // Son çare: boş db’ye schema kur
        if (__DEV__) console.warn('[poiLocal] poi table still missing → creating schema', { country });
        await ensurePoiSchema(db);
        ok = await validatePoiTable(db);
      }

      if (__DEV__) console.log('[poiLocal] re-copy & reopen. poi table ok:', ok);
    } else {
      // TR’de seed dolu, PL’de boş olabilir; tablo varsa schema yine garanti edelim (indexler)
      await ensurePoiSchema(db);
    }

    // 3) seed gerçekten boş mu? (TR için boşsa muhtemelen yanlış kopya)
    try {
      const cnt = await tableCount(db, 'poi');
      if (country === 'TR' && (!Number.isFinite(cnt) || cnt === 0)) {
        if (__DEV__) console.warn('[poiLocal] TR seed looks empty → re-copying shard');
        await nukeShard(country);
        await ensureShardFile(country);
        db = await reallyOpen(SQLite, country);
        await ensurePoiSchema(db);
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

  const seedWhere = [], seedArgs = [];
  const cityTrim = String(city || '').trim();

  if (cityTrim)   { seedWhere.push('city LIKE ? COLLATE NOCASE'); seedArgs.push(`%${cityTrim}%`); }
  if (category)   { seedWhere.push('category = ?');  seedArgs.push(category); }
  if (q && q.trim().length >= 2) {
    seedWhere.push('nameNorm LIKE ?');
    seedArgs.push(`%${normalizeText(q)}%`);
  }

  const hasUser = await (async () => {
    try {
      const r = await runSelect(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='poi_user'`, []);
      return (r?.length || 0) > 0;
    } catch { return false; }
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

  const seedSQL = `
    SELECT id,country,city,category,name,lat,lon,address,NULL AS place_id,'local' AS source
    FROM poi
    ${seedWhere.length ? 'WHERE ' + seedWhere.join(' AND ') : ''}
    LIMIT ${lim}
  `;
  const seedRows = await runSelect(db, seedSQL, seedArgs);

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

  return { rows: [...seedRows, ...userRows].slice(0, lim) };
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
  if (__DEV__ && ok) console.log('[poiLocal] addUserPoi OK:', rec.name, rec.city || '', rec.country);
  return ok;
}

export { runSelect };
