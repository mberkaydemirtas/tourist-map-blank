// app/lib/poiHybrid.js
// Lokal SQLite (shard) + Server fallback hibrit katman:
// - Önce lokal shard → anında sonuç
// - Lokal boş ve q>=2 ise server/google fallback (api.js → poiSearch)
// - Sekme sayaçları için hızlı GROUP BY

import { queryPoi, openPoiDb } from './poiLocal';
import { poiSearch } from './api';

const DEFAULT_COUNTRY = 'TR';
const MAP_CATEGORIES = ['sights', 'restaurants', 'cafes', 'bars', 'museums', 'parks'];

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

// Uygulama açılışında bir kez çağır (asset kopyalama + DB open tetiklenir)
export async function prewarmPoiShard(country = DEFAULT_COUNTRY) {
  const db = await openPoiDb(country);
  return !!db;
}

// Sekme sayaçları
export async function getCategoryCounts({ country = DEFAULT_COUNTRY, city }) {
  const db = await openPoiDb(country);
  if (!db) return Object.fromEntries(MAP_CATEGORIES.map(k => [k, 0]));

  const where = [];
  const args = [];
  if (city) { where.push('city = ?'); args.push(city); }

  const sql = `
    SELECT category, COUNT(*) AS n
    FROM poi
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY category
  `;

  const rows = await new Promise((resolve) => {
    db.readTransaction((tx) => {
      tx.executeSql(
        sql,
        args,
        (_, rs) => resolve(rs.rows._array || []),
        (_, err) => { console.warn('[poiHybrid.getCategoryCounts] sql error', err); resolve([]); }
      );
    });
  });

  const out = Object.fromEntries(MAP_CATEGORIES.map(k => [k, 0]));
  rows.forEach((r) => {
    const key = String(r.category || '').trim();
    if (key && out[key] != null) out[key] = Number(r.n) || 0;
  });
  return out;
}

// Hibrit arama (önce lokal, boşsa server)
export async function searchPoiHybrid({
  country = DEFAULT_COUNTRY,
  city,
  category,
  q = '',
  limit = 50,
  center, // {lat, lng? lon?}
} = {}) {
  const local = await queryPoi({ country, city, category, q, limit });
  const localItems = (local?.rows || []).map(r => toItem(r, 'local'));

  // local bulunduysa veya q kısa ise direkt dön
  if (!q || q.trim().length < 2 || localItems.length > 0) {
    return localItems.slice(0, limit);
  }

  // fallback → server/google
  const lat = Number(center?.lat);
  const lon = Number(center?.lon ?? center?.lng);
  let remote = [];
  try {
    const out = await poiSearch(q.trim(), {
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      city: city || '',
      category: catKeyToQuery(category),
    });
    remote = (out || []).map(r => toItem(r, 'google', category));
  } catch (e) {
    if (__DEV__) console.warn('[poiHybrid.searchPoiHybrid] fallback error:', e?.message || e);
  }
  return remote.slice(0, limit);
}
