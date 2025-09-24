// app/lib/poiLocal.js
const FileSystem = require('expo-file-system');
const { Asset } = require('expo-asset');
const SQLite = require('expo-sqlite');

const SHARDS = { TR: () => require('../../assets/poi_TR.db') };

async function ensureShard(country = 'TR') {
  const assetModule = SHARDS[country]?.();
  if (!assetModule) return null;

  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();
  const dest = FileSystem.documentDirectory + `poi_${country}.db`;
  const exists = await FileSystem.getInfoAsync(dest);
  if (!exists.exists) {
    await FileSystem.copyAsync({ from: asset.localUri || asset.uri, to: dest });
  }
  return dest;
}

async function openPoiDb(country = 'TR') {
  const path = await ensureShard(country);
  if (!path) return null;
  // expo-sqlite accepts only a “name”, not full path → copy is already in documentDirectory
  return SQLite.openDatabase(`poi_${country}.db`);
}

async function queryPoi({ country = 'TR', city, category, q, limit = 50 }) {
  const db = await openPoiDb(country);
  if (!db) return { rows: [] };

  const where = [];
  const args = [];
  if (city) { where.push('city = ?'); args.push(city); }
  if (category) { where.push('category = ?'); args.push(category); }
  if (q && q.trim().length >= 2) {
    where.push('nameNorm LIKE ?');
    args.push(`%${normalize(q)}%`);
  }

  const sql = `SELECT id,country,city,category,name,lat,lon,address 
               FROM poi ${where.length ? 'WHERE ' + where.join(' AND ') : ''} 
               LIMIT ${limit}`;

  const rows = await new Promise((resolve) => {
    db.readTransaction(tx => {
      tx.executeSql(
        sql,
        args,
        (_, rs) => resolve(rs.rows._array || []),
        (_, err) => { console.warn('poi query err', err); resolve([]); }
      );
    });
  });
  return { rows };
}

function normalize(s = '') {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[İIı]/g, 'i').replace(/[Şş]/g, 's')
    .replace(/[Ğğ]/g, 'g').replace(/[Üü]/g, 'u')
    .replace(/[Öö]/g, 'o').replace(/[Çç]/g, 'c')
    .toLowerCase().trim();
}

module.exports = {
  openPoiDb,
  queryPoi
};
