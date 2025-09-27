// app/lib/poiHybrid.js
import { queryPoi, openPoiDb } from './poiLocal';
import { poiSearch, poiAutocomplete } from './api.js';

const DEFAULT_COUNTRY = 'TR';
const MAP_CATEGORIES = ['sights','restaurants','cafes','bars','museums','parks'];

/* -------------------- kategori → Google type -------------------- */
function catKeyToQuery(k) {
  if (k === 'restaurants') return 'restaurant';
  if (k === 'cafes')       return 'cafe';
  if (k === 'bars')        return 'bar';
  if (k === 'museums')     return 'museum';
  if (k === 'parks')       return 'park';
  return '';
}

/* ---------------------------- normalize ---------------------------- */
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

/* ----------------------------- prewarm ----------------------------- */
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
const norm   = (s) => asciiFold(s).toLowerCase().trim();
const round6 = (n) => Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : NaN;
function makeKey(it) {
  if (it.place_id) return `pid:${it.place_id}`;
  const n = norm(it.name || '');
  const a = round6(Number(it.lat));
  const b = round6(Number(it.lon ?? it.lng));
  const c = norm(it.city || '');
  return `nlc:${n}|${a}|${b}|${c}`;
}
const mergeUniq = (...arrays) => {
  const m = new Map();
  arrays.flat().forEach(it => { if (it) m.set(makeKey(it), it); });
  return Array.from(m.values());
};

/* --------------------------------------------------------------------------
 * LOCAL SEARCH (DB)
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

  // q kısa ve şehirde hiç yoksa ülke geneline düş
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
 * GOOGLE FETCH (tek atım: önce autocomplete, boşsa text search)
 * -------------------------------------------------------------------------- */
async function searchGoogleOnce(qTrim, {
  lat, lon, city, category, limit = 10, sessionToken, timeoutMs
}) {
  const toG = (r) => toItem(r, 'google', category || 'sights');

  // 1) Autocomplete
  try {
    const ac = await poiAutocomplete(qTrim, {
      lat: Number.isFinite(Number(lat)) ? Number(lat) : undefined,
      lon: Number.isFinite(Number(lon)) ? Number(lon) : undefined,
      city: city || '',
      limit,
      sessionToken,
      timeoutMs,
    });
    if (Array.isArray(ac) && ac.length) return ac.map(toG);
  } catch (e) {
    if (__DEV__) console.warn('[hybrid] autocomplete fail:', e?.message || e);
  }

  // 2) Text Search (kategori bias’ı)
  try {
    const type = catKeyToQuery(category);
    const ts = await poiSearch(qTrim, {
      lat: Number.isFinite(Number(lat)) ? Number(lat) : undefined,
      lon: Number.isFinite(Number(lon)) ? Number(lon) : undefined,
      city: city || '',
      category: type,
      timeoutMs,
    });
    return (Array.isArray(ts) ? ts : []).map(toG);
  } catch (e) {
    if (__DEV__) console.warn('[hybrid] textsearch fail:', e?.message || e);
    return [];
  }
}

/* --------------------------------------------------------------------------
 * HYBRID THRESHOLD
 * - Önce lokal (DB)
 * - q varsa ve lokal < minLocal ise Google’dan ekle
 * - her durumda de-dup + limit
 * -------------------------------------------------------------------------- */
export async function searchPoiHybridThreshold({
  country = DEFAULT_COUNTRY,
  city,
  category,
  q = '',
  limit = 50,
  center,              // { lat, lng|lon }
  minLocal = 3,
  sessionToken,
  timeoutMs,
} = {}) {
  const qTrim = (q || '').trim();
  const local = await searchPoiLocal({ country, city, category, q: qTrim, limit });

  // q yoksa → sadece lokal top-20 (sabit liste hissi)
  if (!qTrim) return local.slice(0, Math.max(20, Math.min(limit, 50)));

  // q varsa: lokal yeterliyse direkt dön
  if (local.length >= minLocal) return local.slice(0, limit);

  // lokal az → Google ekle
  const lat = Number(center?.lat);
  const lon = Number(center?.lon ?? center?.lng);
  const remote = await searchGoogleOnce(qTrim, { lat, lon, city, category, limit: 12, sessionToken, timeoutMs });

  const merged = mergeUniq(local, remote).slice(0, limit);
  if (__DEV__) {
    const g = merged.filter(x => x?.source === 'google').length;
    const l = merged.length - g;
    console.log(`[hybridThreshold] q="${qTrim}" cat=${category} → total=${merged.length} local=${l} google=${g}`);
  }
  return merged;
}

/* --------------------------------------------------------------------------
 * (opsiyonel) Eskilerle uyum için basit hibrit
 * -------------------------------------------------------------------------- */
export async function searchPoiHybrid(opts = {}) {
  const local = await searchPoiLocal(opts);
  const qTrim = (opts?.q || '').trim();
  if (!qTrim) return local;
  // lokal + google simple append (eşiksiz)
  const lat = Number(opts?.center?.lat);
  const lon = Number(opts?.center?.lon ?? opts?.center?.lng);
  const remote = await searchGoogleOnce(qTrim, {
    lat, lon, city: opts?.city, category: opts?.category, limit: 12, sessionToken: opts?.sessionToken,
  });
  return mergeUniq(local, remote).slice(0, Number(opts?.limit) || 50);
}
