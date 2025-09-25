// app/lib/db.js
// Tek nokta DB yöneticisi (Expo + React Native)
// - Modern API: expo-sqlite (openDatabaseAsync)
// - Eski API fallback: SQLite.openDatabase + executeSql (callback)
// - Basit migration sistemi (PRAGMA user_version)
// - Sık kullanılan yardımcılar: queryAll, queryOne, run, exec

let _dbPromise = null;
const DB_NAME = 'touristmap.db';

export async function getDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = _openAndMigrate();
  return _dbPromise;
}

// ----- Public helpers (kolay kullanım) -----
export async function queryAll(sql, params = []) {
  const db = await getDB();
  return _hasAsync(db) ? db.getAllAsync(sql, params) : _legacyAll(db, sql, params);
}

export async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function run(sql, params = []) {
  const db = await getDB();
  if (_hasAsync(db)) return db.runAsync(sql, params);
  await _legacyRun(db, sql, params);
  return true;
}

export async function exec(sql) {
  const db = await getDB();
  if (_hasAsync(db)) return db.execAsync(sql);
  // Legacy exec: parçala ve sırayla çalıştır
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const st of statements) {
    await _legacyRun(db, st);
  }
  return true;
}

// ----- Internal: open & migrate -----
async function _openAndMigrate() {
  // Dinamik import: web bundler ve testlerde sorun çıkarmaz
  const SQLite = await import('expo-sqlite').catch(() => null);
  if (!SQLite) {
    throw new Error(
      'expo-sqlite bulunamadı. Lütfen "npx expo install expo-sqlite" çalıştırın.'
    );
  }

  const db = await _openDb(SQLite);

  // Performans için WAL
  try {
    await _execPragma(db, `PRAGMA journal_mode = WAL;`);
  } catch {}

  // Şema versiyonu
  const currentVersion = await _getUserVersion(db);

  // v1 -> Temel tablolar (ihtiyaçlarına göre genişlet)
  if (currentVersion < 1) {
    await _createV1(db);
    await _setUserVersion(db, 1);
  }

  // Örnek: ileride bir V2 gerektiğinde:
  // if (currentVersion < 2) {
  //   await _migrateToV2(db);
  //   await _setUserVersion(db, 2);
  // }

  return db;
}

async function _openDb(SQLite) {
  // Modern API var mı?
  if (SQLite.openDatabaseAsync) {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    // Modern API: { execAsync, runAsync, getAllAsync, getFirstAsync, closeAsync }
    return db;
  }

  // Legacy API
  const db = SQLite.openDatabase(DB_NAME);

  // Legacy’yi modern benzeri sarmalayıcıyla zenginleştir
  db.getAllAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.readTransaction((tx) => {
        tx.executeSql(
          sql,
          params,
          (_, res) => {
            const out = [];
            for (let i = 0; i < res.rows.length; i++) out.push(res.rows.item(i));
            resolve(out);
          },
          (_, err) => {
            reject(err);
            return false;
          }
        );
      });
    });

  db.getFirstAsync = async (sql, params = []) => {
    const rows = await db.getAllAsync(sql, params);
    return rows[0] || null;
  };

  db.runAsync = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.transaction((tx) => {
        tx.executeSql(
          sql,
          params,
          () => resolve(true),
          (_, err) => {
            reject(err);
            return false;
          }
        );
      });
    });

  db.execAsync = async (sql) => {
    const parts = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) {
      // eslint-disable-next-line no-await-in-loop
      await db.runAsync(p);
    }
    return true;
  };

  return db;
}

// ----- Internal: migration helpers -----
function _hasAsync(db) {
  return typeof db?.getAllAsync === 'function';
}

async function _execPragma(db, pragmaSql) {
  if (_hasAsync(db)) return db.execAsync(pragmaSql);
  return _legacyExec(db, pragmaSql);
}

async function _getUserVersion(db) {
  // getFirstAsync PRAGMA dönüşü { user_version: N } olur (modern),
  // legacy’de map’leriz.
  if (_hasAsync(db)) {
    const row = await db.getFirstAsync('PRAGMA user_version;');
    return row?.user_version ?? 0;
  }
  const rows = await _legacyAll(db, 'PRAGMA user_version;');
  return rows?.[0]?.user_version ?? 0;
}

async function _setUserVersion(db, v) {
  await _execPragma(db, `PRAGMA user_version = ${Number(v) || 0};`);
}

// V1 şema: temel tablolar
async function _createV1(db) {
  const sql = `
    CREATE TABLE IF NOT EXISTS trips (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      city          TEXT,
      start_date    TEXT,
      end_date      TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS poi (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      province      TEXT,
      lat           REAL,
      lon           REAL,
      amenity       TEXT,
      shop          TEXT,
      tourism       TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    -- Hızlı arama için indeksler
    CREATE INDEX IF NOT EXISTS idx_poi_province ON poi(province);
    CREATE INDEX IF NOT EXISTS idx_poi_name     ON poi(name);
  `;
  await exec(sql);
}

// ----- Legacy helpers -----
function _legacyAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.readTransaction((tx) => {
      tx.executeSql(
        sql,
        params,
        (_, res) => {
          const out = [];
          for (let i = 0; i < res.rows.length; i++) out.push(res.rows.item(i));
          resolve(out);
        },
        (_, err) => {
          reject(err);
          return false;
        }
      );
    });
  });
}

function _legacyRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        sql,
        params,
        () => resolve(true),
        (_, err) => {
          reject(err);
          return false;
        }
      );
    });
  });
}

function _legacyExec(db, sql) {
  const parts = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.reduce(
    (p, st) => p.then(() => _legacyRun(db, st)),
    Promise.resolve()
  );
}
