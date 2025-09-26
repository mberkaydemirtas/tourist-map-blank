// app/lib/poiHybrid.js
import { queryPoi, openPoiDb } from './poiLocal';
import { poiSearch, poiAutocomplete as _poiAutocomplete } from './api.js';

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
  const lat = Number(row.lat);
  const lon = Number(row.lon ?? row.lng);
  return {
    id: String(row.id ?? row.place_id ?? Math.random().toString(36).slice(2)),
    name: row.name || '(isimsiz)',
    category,
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
    address: row.address || row.formatted_address || row.description || '',
    city: row.city || '',
    place_id: row.place_id,
    source,
  };
}

export async function prewarmPoiShard(country = DEFAULT_COUNTRY) {
  const db = await openPoiDb(country);
  return !!db;
}

/* -------------------- Category counts (lokal DB) -------------------- */
export async function getCategoryCounts({ country = DEFAULT_COUNTRY, city }) {
  const db = await openPoiDb(country);
  if (!db) return Object.fromEntries(MAP_CATEGORIES.map(k => [k, 0]));
  const hasAsync = typeof db.getAllAsync === 'function';

  async function run(withCity) {
    const where = [], args = [];
    if (withCity && city) { where.push('city = ?'); args.push(String(city).trim()); }
    const sql = `
      SELECT category, COUNT(*) AS n
      FROM poi
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY category
    `;
    let rows = [];
    try {
      if (hasAsync) rows = await db.getAllAsync(sql, args);
      else rows = await new Promise((resolve) => {
        db.readTransaction((tx) => {
          tx.executeSql(sql, args, (_, rs) => resolve(rs?.rows?._array || []),
            () => { resolve([]); return false; });
        });
      });
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

  const countsCity = await run(true);
  const totalCity = Object.values(countsCity).reduce((a,b)=>a+b,0);
  if (city && totalCity === 0) {
    const countsAll = await run(false);
    console.log('[poiHybrid] counts fallback to no-city. given city:', city, 'counts:', countsAll);
    return countsAll;
  }
  return countsCity;
}

/* ------------------------- de-dup helpers ------------------------- */
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

/* --------------------------------------------------------------------------
 * FAST LOCAL ONLY (kullanım dışı bırakılmadı — sayaçlar için mevcut)
 * -------------------------------------------------------------------------- */
export async function searchPoiLocal({
  country = DEFAULT_COUNTRY,
  city,
  category,
  q = '',
  limit = 50,
} = {}) {
  const qTrim = (q || '').trim();
  const first = await queryPoi({ country, city, category, q: qTrim, limit });
  let localItems = (first?.rows || []).map(r => toItem(r, 'local'));

  if (qTrim.length < 2) {
    if (localItems.length === 0 && city) {
      const second = await queryPoi({ country, city: undefined, category, q: '', limit });
      localItems = (second?.rows || []).map(r => toItem(r, 'local'));
      if (localItems.length) {
        console.log('[poiHybrid] list fallback to no-city for category:', category, 'city was:', city);
      }
    }
  }
  return localItems.slice(0, limit);
}

/* --------------------------------------------------------------------------
 * GOOGLE-ONLY (Autocomplete listesi — DB yorumlandı)
 * -------------------------------------------------------------------------- */
export async function searchPoiGoogleOnly({
  city,
  category,           // UI sekmesi için kategori bilgisini set edelim
  q = '',
  limit = 50,
  center,              // { lat, lon|lng }
  sessionToken,
} = {}) {
  const qTrim = (q || '').trim();
  if (!qTrim) return []; // boş aramada artık liste yok

  const lat = Number(center?.lat);
  const lon = Number(center?.lon ?? center?.lng);

  try {
    const raw = await _poiAutocomplete(qTrim, {
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      city: city || '',
      limit: Number(limit) || 50,
      sessionToken,
    });

    // server array döndürüyor; güvenli tarafta kalalım
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.predictions) ? raw.predictions : []);
    const items = arr.map(r => toItem(r, 'google', category || 'sights'));
    if (__DEV__) console.log('[GoogleOnly] items=', items.length, 'q=', qTrim);
    return items.slice(0, Number(limit) || 50);
  } catch (e) {
    if (__DEV__) console.warn('[GoogleOnly] error:', e?.message || e);
    return [];
  }
}

/* --------------------------------------------------------------------------
 * REMOTE APPEND (eski hibrit; artık TripListQuestion bunu kullanmayacak)
 * -------------------------------------------------------------------------- */
export async function searchPoiRemoteAppend({
  country = 'TR',
  city,
  category,
  q = '',
  limit = 50,
  center,
  existing = [],
  sessionToken,
  signal,
} = {}) {
  if (__DEV__) console.log('[RemoteAppend] typeof _poiAutocomplete =', typeof _poiAutocomplete);

  const qTrim = (q || '').trim();
  const needRemote = qTrim.length >= 2;
  if (__DEV__) console.log('[RemoteAppend] existing=', existing.length, 'qLen=', qTrim.length, 'needRemote=', needRemote);
  if (!needRemote) return existing.slice(0, limit);

  const lat = Number(center?.lat);
  const lon = Number(center?.lon ?? center?.lng);

  const cat = (() => {
    if (category === 'restaurants') return 'restaurant';
    if (category === 'cafes')       return 'cafe';
    if (category === 'bars')        return 'bar';
    if (category === 'museums')     return 'museum';
    if (category === 'parks')       return 'park';
    return '';
  })();

  const toGItem = (row) => ({
    id: String(row.id ?? row.place_id ?? Math.random().toString(36).slice(2)),
    name: row.name || '(isimsiz)',
    category: category || row.category || 'sights',
    lat: Number.isFinite(Number(row.lat)) ? Number(row.lat) : undefined,
    lon: Number.isFinite(Number(row.lon ?? row.lng)) ? Number(row.lon ?? row.lng) : undefined,
    address: row.address || row.formatted_address || row.description || '',
    city: row.city || '',
    place_id: row.place_id,
    source: 'google',
  });
  const toArr = (v) => Array.isArray(v) ? v : (Array.isArray(v?.results) ? v.results : []);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const autoPromiseRaw = (async () => {
    if (typeof _poiAutocomplete !== 'function') return [];
    try {
      const auto = await _poiAutocomplete(qTrim, {
        lat: Number.isFinite(lat) ? lat : undefined,
        lon: Number.isFinite(lon) ? lon : undefined,
        city: city || '',
        limit: 8,
        sessionToken,
      });
      const arr = toArr(auto).map(toGItem);
      if (__DEV__) console.log('[RemoteAppend:auto] count=', arr.length);
      return arr;
    } catch (e) {
      if (__DEV__) console.warn('[RemoteAppend:auto] error:', e?.message || e);
      return [];
    }
  })();

  const runTextSearch = async () => {
    try {
      const near = await poiSearch(qTrim, {
        lat: Number.isFinite(lat) ? lat : undefined,
        lon: Number.isFinite(lon) ? lon : undefined,
        city: city || '',
        category: qTrim.length >= 3 ? '' : cat,
        timeoutMs: 12000,
        signal,
      });
      let arr = (near || []).map(toGItem);
      if (__DEV__) console.log('[RemoteAppend:text:near] count=', arr.length);
      if (arr.length > 0) return arr;

      const byCity = await poiSearch(qTrim, {
        city: city || '',
        category: '',
        timeoutMs: 12000,
        signal,
      });
      arr = (byCity || []).map(toGItem);
      if (__DEV__) console.log('[RemoteAppend:text:city] count=', arr.length);
      if (arr.length > 0) return arr;

      const global = await poiSearch(qTrim, {
        category: '',
        timeoutMs: 12000,
        signal,
      });
      arr = (global || []).map(toGItem);
      if (__DEV__) console.log('[RemoteAppend:text:global] count=', arr.length);
      return arr;
    } catch (e) {
      if (__DEV__) console.warn('[RemoteAppend:text] error:', e?.message || e);
      return [];
    }
  };

  const textPromiseDelayed = (async () => {
    await wait(700);
    return await runTextSearch();
  })();

  let autoItems = [];
  let textItems = [];

  const early = await Promise.race([
    autoPromiseRaw.then(a => ({ from: 'auto', items: a })),
    textPromiseDelayed.then(t => ({ from: 'text', items: t })),
  ]);

  if (early?.from === 'auto') autoItems = early.items || [];
  if (early?.from === 'text') textItems = early.items || [];

  function mergeAndSlice() {
    const uniq = new Map();
    const mk = (it) => {
      if (it.place_id) return `pid:${it.place_id}`;
      const n = (it.name || '').toLowerCase().trim();
      const a = Number.isFinite(Number(it.lat)) ? Math.round(Number(it.lat) * 1e6) / 1e6 : NaN;
      const b = Number.isFinite(Number(it.lon)) ? Math.round(Number(it.lon) * 1e6) / 1e6 : NaN;
      const c = (it.city || '').toLowerCase().trim();
      return `nlc:${n}|${a}|${b}|${c}`;
    };
    for (const it of existing)  uniq.set(mk(it), it);
    for (const it of autoItems) uniq.set(mk(it), it);
    for (const it of textItems) uniq.set(mk(it), it);
    const merged = Array.from(uniq.values()).slice(0, limit);
    if (__DEV__) {
      const g = merged.filter(x => x?.source === 'google').length;
      const l = merged.length - g;
      console.log(`[RemoteAppend] merged total=${merged.length} local=${l} google=${g} q="${qTrim}" cat=${category}`);
    }
    return merged;
  }

  if ((autoItems?.length || 0) > 0 || (textItems?.length || 0) > 0) {
    return mergeAndSlice();
  }

  if (early?.from === 'auto') {
    textItems = await textPromiseDelayed.catch(() => []);
  } else {
    autoItems = await autoPromiseRaw.catch(() => []);
  }
  return mergeAndSlice();
}

/* --------------------------------------------------------------------------
 * HYBRID (compat) — artık aramada kullanmıyoruz, ama export kalsın
 * -------------------------------------------------------------------------- */
export async function searchPoiHybrid(opts = {}) {
  const local = await searchPoiLocal(opts);
  const qTrim = (opts?.q || '').trim();
  if (!qTrim) return local;
  return await searchPoiRemoteAppend({ ...opts, existing: local });
}
