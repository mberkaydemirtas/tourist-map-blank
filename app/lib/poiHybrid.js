// app/lib/poiHybrid.js
// Lokal SQLite (shard) + Server fallback hibrit katman:
// - Önce lokal shard → anında sonuç
// - Lokal boş ve q>=2 ise server/google fallback (api.js → poiSearch)
// - Sekme sayaçları için hızlı GROUP BY

import { queryPoi, openPoiDb } from './poiLocal';
import { poiSearch } from './api';

const DEFAULT_COUNTRY = 'TR';
const MAP_CATEGORIES = ['sights','restaurants','cafes','bars','museums','parks'];

function catKeyToQuery(k) {
  if (k === 'restaurants') return 'restaurant';
  if (k === 'cafes') return 'cafe';
  if (k === 'bars') return 'bar';
  if (k === 'museums') return 'museum';
  if (k === 'parks') return 'park';
  return '';
}

function toItem(row, source = 'local', enforcedCategory) {
  const category = enforcedCategory || row.category || 'sights';
  const lat = Number(row.lat), lon = Number(row.lon);
  return {
    id: String(row.id ?? row.place_id ?? Math.random().toString(36).slice(2)),
    name: row.name || '(isimsiz)',
    category,
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
    address: row.address || '',
    city: row.city || '',
    place_id: row.place_id,
    source,
  };
}

export async function prewarmPoiShard(country = DEFAULT_COUNTRY) {
  const db = await openPoiDb(country);
  return !!db;
}

// ⬇️ Fallback: city ile 0 çıkarsa şehir filtresiz tekrar dene
export async function getCategoryCounts({ country = DEFAULT_COUNTRY, city }) {
  const db = await openPoiDb(country);
  if (!db) return Object.fromEntries(MAP_CATEGORIES.map(k => [k, 0]));

  const hasAsync = typeof db.getAllAsync === 'function';

  async function run(withCity) {
    const where = [];
    const args = [];
    if (withCity && city) { where.push('city = ?'); args.push(String(city).trim()); }
    const sql = `
      SELECT category, COUNT(*) AS n
      FROM poi
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY category
    `;

    let rows = [];
    try {
      if (hasAsync) {
        rows = await db.getAllAsync(sql, args);
      } else {
        rows = await new Promise((resolve) => {
          db.readTransaction((tx) => {
            tx.executeSql(sql, args, (_, rs) => resolve(rs?.rows?._array || []),
              () => { resolve([]); return false; });
          });
        });
      }
    } catch (err) {
      console.warn('[getCategoryCounts] sql error', err?.message || err);
      rows = [];
    }

    const out = Object.fromEntries(MAP_CATEGORIES.map(k => [k, 0]));
    rows.forEach(r => {
      const key = String(r.category || '').trim();
      if (key && out[key] != null) out[key] = Number(r.n) || 0;
    });
    return out;
  }

  // önce şehirli, 0 ise şehirsiz
  const countsCity = await run(true);
  const totalCity = Object.values(countsCity).reduce((a,b)=>a+b,0);
  if (city && totalCity === 0) {
    const countsAll = await run(false);
    console.log('[poiHybrid] counts fallback to no-city. given city:', city, 'counts:', countsAll);
    return countsAll;
  }
  return countsCity;
}

// ⬇️ Fallback: q boş & lokal 0 ise şehirsiz tekrar dene; yine 0 ise remote
export async function searchPoiHybrid({
  country = DEFAULT_COUNTRY,
  city,
  category,
  q = '',
  limit = 50,
  center,
} = {}) {
  const first = await queryPoi({ country, city, category, q, limit });
  let localItems = (first?.rows || []).map(r => toItem(r, 'local'));

  if ((!q || q.trim().length < 2) && localItems.length === 0 && city) {
    const second = await queryPoi({ country, city: undefined, category, q: '', limit });
    localItems = (second?.rows || []).map(r => toItem(r, 'local'));
    if (localItems.length) {
      console.log('[poiHybrid] list fallback to no-city for category:', category, 'city was:', city);
    }
  }

  if (!q || q.trim().length < 2 || localItems.length > 0) {
    return localItems.slice(0, limit);
  }

  // remote fallback (Google/server)
  const lat = Number(center?.lat);
  const lon = Number(center?.lon ?? center?.lng);
  try {
    const out = await poiSearch(q.trim(), {
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      city: city || '',
      category: catKeyToQuery(category),
    });
    const remote = (out || []).map(r => toItem(r, 'google', category));
    return remote.slice(0, limit);
  } catch (e) {
    if (__DEV__) console.warn('[poiHybrid.searchPoiHybrid] remote error:', e?.message || e);
    return [];
  }
}