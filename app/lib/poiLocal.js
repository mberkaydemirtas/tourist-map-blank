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

/**
 * Tek giriş noktası: openPoiDb
 * - İlk çağrıyı kilitler (race engellenir)
 * - Tablonun varlığını doğrular
 * - Gerekirse bir defaya mahsus sil & yeniden kopyala & tekrar aç
 */
export async function openPoiDb(country = 'TR') {
  if (Platform.OS === 'web') return null;

  // cache’e bak
  if (dbCache.has(country)) return dbCache.get(country);

  // devam eden bir init varsa bekle
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
      // sadece bu aşamada sil-yeniden-kopyala
      const sqliteDir = FileSystem.documentDirectory + 'SQLite/';
      const dest = sqliteDir + `poi_${country}.db`;
      try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch {}
      await ensureShard(country);
      db = await reallyOpen(SQLite, country);
      ok = await validatePoiTable(db);
      if (__DEV__) console.log('[poiLocal] re-copy & reopen. poi table ok:', ok);
    }

    validated.add(country);
    dbCache.set(country, db);
    return db;
  })();

  initLock.set(country, p);
  const result = await p.finally(() => initLock.delete(country));
  return result;
}

// ---- query helper (async first, one-shot retry) ----
async function runSelect(db, sql, args) {
  // async API
  if (typeof db.getAllAsync === 'function') {
    try {
      return await db.getAllAsync(sql, args);
    } catch (e) {
      // prepareAsync NPE vs benzeri için bir kez daha deneyelim: küçük gecikme + reopen
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

  // legacy API
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

function normalize(s = '') {
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

export async function queryPoi({ country = 'TR', city, category, q, limit = 50 }) {
  const db = await openPoiDb(country);
  if (!db) return { rows: [] };

  const where = [], args = [];
  const cityTrim = String(city || '').trim();
  if (cityTrim)   { where.push('city = ?');      args.push(cityTrim); }
  if (category)   { where.push('category = ?');  args.push(category); }
  if (q && q.trim().length >= 2) {
    where.push('nameNorm LIKE ?'); args.push(`%${normalize(q)}%`);
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
