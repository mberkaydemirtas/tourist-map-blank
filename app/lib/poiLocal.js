// app/lib/poiLocal.js
// Expo-Asset içinden .db’yi (assets/poi_TR.db) documentDirectory’ye kopyalar
// ve expo-sqlite ile açar. Basit SELECT/LIKE sorguları sağlar.

import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
import * as SQLite from 'expo-sqlite';

const SHARDS = {
  TR: () => require('../../assets/poi_TR.db'), // Asset’e eklendiğinden emin olun
};

async function ensureShard(country = 'TR') {
  const assetModule = SHARDS[country]?.();
  if (!assetModule) return null;

  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();
  const dest = FileSystem.documentDirectory + `poi_${country}.db`;

  const info = await FileSystem.getInfoAsync(dest);
  if (!info.exists) {
    await FileSystem.copyAsync({
      from: asset.localUri || asset.uri,
      to: dest,
    });
  }
  return dest;
}

export async function openPoiDb(country = 'TR') {
  const path = await ensureShard(country);
  if (!path) return null;
  // expo-sqlite path yerine name alır; documentDirectory’ye kopyaladığımız için name yeterli
  return SQLite.openDatabase(`poi_${country}.db`);
}

export async function queryPoi({ country = 'TR', city, category, q, limit = 50 }) {
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

  const sql = `
    SELECT id,country,city,category,name,lat,lon,address,place_id
    FROM poi
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    LIMIT ${Number(limit) || 50}
  `;

  const rows = await new Promise((resolve) => {
    db.readTransaction((tx) => {
      tx.executeSql(
        sql,
        args,
        (_, rs) => resolve(rs.rows._array || []),
        (_, err) => {
          console.warn('[poiLocal.queryPoi] sql error:', err);
          resolve([]);
        }
      );
    });
  });

  return { rows };
}

function normalize(s = '') {
  try {
    return s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[İIı]/g, 'i')
      .replace(/[Şş]/g, 's')
      .replace(/[Ğğ]/g, 'g')
      .replace(/[Üü]/g, 'u')
      .replace(/[Öö]/g, 'o')
      .replace(/[Çç]/g, 'c')
      .toLowerCase()
      .trim();
  } catch {
    return String(s || '').toLowerCase().trim();
  }
}
