// app/lib/poiHybrid.js
// Lokal SQLite (shard) + Server fallback hibrit katman:
// - Önce lokal shard → anında sonuç
// - q < 2: sadece lokal (gerekirse şehir filtresiz fallback)
// - q ≥ 2: lokal + Google (append, uniq), Google çağrısı api.js → poiSearch
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

// --- küçük yardımcılar (de-dup anahtarı) ---
const asciiFold = (s) => String(s ?? '').replace(
  /[İIıŞşĞğÜüÖöÇç]/g,
  ch => ({'İ':'i','I':'i','ı':'i','Ş':'s','ş':'s','Ğ':'g','ğ':'g','Ü':'u','ü':'u','Ö':'o','ö':'o','Ç':'c','ç':'c'}[ch] || ch)
);
const norm = (s) => asciiFold(s).toLowerCase().trim();
const round6 = (n) => Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : NaN;
function makeKey(it) {
  if (it.place_id) return `pid:${it.place_id}`;
  const n = norm(it.name || '');
  const a = round6(Number(it.lat));
  const b = round6(Number(it.lon ?? it.lng));
  const c = norm(it.city || '');
  return `nlc:${n}|${a}|${b}|${c}`;
}

// ⬇️ Hibrit arama:
// q < 2 → (lokal, gerekirse şehir filtresiz fallback)
// q ≥ 2 → lokal + remote (append), uniq, local öncelikli sırada
export async function searchPoiHybrid({
  country = DEFAULT_COUNTRY,
  city,
  category,
  q = '',
  limit = 50,
  center,
} = {}) {
  const qTrim = (q || '').trim();

  // 1) LOCAL (her durumda)
  const first = await queryPoi({ country, city, category, q: qTrim, limit });
  let localItems = (first?.rows || []).map(r => toItem(r, 'local'));

  // q < 2 ise: sadece lokal; lokal 0 ve city varsa → şehir filtresiz fallback
  if (qTrim.length < 2) {
    if (localItems.length === 0 && city) {
      const second = await queryPoi({ country, city: undefined, category, q: '', limit });
      localItems = (second?.rows || []).map(r => toItem(r, 'local'));
      if (localItems.length) {
        console.log('[poiHybrid] list fallback to no-city for category:', category, 'city was:', city);
      }
    }
    return localItems.slice(0, limit);
  }

  // 2) REMOTE (Google/server) — q ≥ 2 → ekle/append
  const lat = Number(center?.lat);
  const lon = Number(center?.lon ?? center?.lng);

  try {
    const out = await poiSearch(qTrim, {
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      city: city || '',
      category: catKeyToQuery(category),
      timeoutMs: 10000, // api.js gerektiğinde retry edecek
    });
    const remoteItems = (out || []).map(r => toItem(r, 'google', category));

    // 3) Merge (local öncelikli) + uniq
    const uniq = new Map();
    for (const it of localItems) {
      const k = makeKey(it);
      if (!uniq.has(k)) uniq.set(k, it);
    }
    for (const it of remoteItems) {
      const k = makeKey(it);
      if (!uniq.has(k)) uniq.set(k, it);
    }

    return Array.from(uniq.values()).slice(0, limit);
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    const aborted = e?.name === 'AbortError' || msg.includes('abort');
    if (!aborted && __DEV__) console.warn('[poiHybrid.searchPoiHybrid] remote error:', e?.message || e);
    // remote patlarsa en azından lokal sonuçları göster
    return localItems.slice(0, limit);
  }
}
