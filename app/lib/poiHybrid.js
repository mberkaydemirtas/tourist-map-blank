// app/lib/poiHybrid.js
import { queryPoiWithUser as queryPoi, openPoiDb, addUserPoi as addUserPoiRaw, runSelect } from './poiLocal';
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

/* ----------------------- kategori çıkarımı (heuristic) ----------------------- */
function inferCategory(row) {
  const raw = `${row?.category ?? ''}`.trim().toLowerCase();
  if (MAP_CATEGORIES.includes(raw)) return raw;

  const t = `${row?.name ?? ''} ${row?.address ?? ''}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch => ({'İ':'i','I':'i','ı':'i','Ş':'s','ş':'s','Ğ':'g','ğ':'g','Ü':'u','ü':'u','Ö':'o','ö':'o','Ç':'c','ç':'c'}[ch] || ch));

  const has = (arr) => arr.some(k => t.includes(k));

  if (has(['museum','muzesi','müze'])) return 'museums';
  if (has(['park','koru','mesire','botanik'])) return 'parks';
  if (has(['bar','pub','meyhane','tapas'])) return 'bars';
  if (has(['cafe','kafe','coffee','kahve','pastane','patisserie','bakery'])) return 'cafes';
  if (has(['restaurant','restoran','lokanta','ocakbasi','ocakbaşı','kebap','balik','balık','pizza','burger','doner','döner','meze'])) return 'restaurants';

  if (has(['castle','kale','kalesi','tower','kule','bridge','kopru','köprü','old town','bazaar','çarşı','mosque','camii','church','kilise','ruins','harabe','monument','anıt','statue','heykel','square','meydan','palace','saray'])) {
    return 'sights';
  }
  return 'sights';
}

/* ---------------------------- normalize ---------------------------- */
function toItem(row, source = 'local', enforcedCategory) {
  const lat = Number(row.lat);
  const lon = Number(row.lon ?? row.lng);

  const cat =
    enforcedCategory ||
    (MAP_CATEGORIES.includes(String(row.category)) ? row.category : null) ||
    inferCategory(row);

  return {
    id: String(row.id ?? row.place_id ?? Math.random().toString(36).slice(2)),
    name: row.name || '(isimsiz)',
    category: cat,
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

/* -------------------- ✅ SAFE addUserPoi (country+city garantili) -------------------- */
function normCountry(c) {
  const cc = String(c || DEFAULT_COUNTRY).trim().toUpperCase();
  return cc || DEFAULT_COUNTRY;
}
function normCity(c) {
  return String(c || '').trim();
}

/**
 * DİKKAT: şehir boş giderse, sonra city filter ile aramada görünmez.
 * Bu wrapper bunu yakalar.
 */
export async function addUserPoi(payload = {}) {
  const country = normCountry(payload.country);
  const city = normCity(payload.city);

  if (__DEV__) {
    if (!payload.country) console.warn('[poiHybrid.addUserPoi] country missing → defaulting to', country);
    if (!city) console.warn('[poiHybrid.addUserPoi] city is empty → results may not appear in city-filtered searches');
  }

  // category normalize
  const category =
    payload.category && MAP_CATEGORIES.includes(String(payload.category))
      ? String(payload.category)
      : inferCategory(payload);

  return addUserPoiRaw({
    ...payload,
    country,
    city,
    category,
  });
}

/* -------------------- Derived counts fallback -------------------- */
async function getCategoryCountsDerived({ country = DEFAULT_COUNTRY, city }) {
  const db = await openPoiDb(country);
  const zeros = Object.fromEntries(MAP_CATEGORIES.map(k => [k, 0]));
  if (!db) return zeros;

  const where = [], args = [];
  if (city && String(city).trim()) { where.push('city LIKE ? COLLATE NOCASE'); args.push(`%${String(city).trim()}%`); }

  const LIMIT_SCAN = 2000;
  const sql = `
    SELECT id,city,category,name,lat,lon,address
    FROM poi
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    LIMIT ${LIMIT_SCAN}
  `;
  const rows = await runSelect(db, sql, args);
  const out = { ...zeros };
  for (const r of rows) {
    const cat = inferCategory(r);
    if (out[cat] != null) out[cat] += 1;
  }
  return out;
}

/* -------------------- Category counts (lokal DB) -------------------- */
export async function getCategoryCounts({ country = DEFAULT_COUNTRY, city }) {
  const db = await openPoiDb(country);
  const zeros = Object.fromEntries(MAP_CATEGORIES.map(k => [k, 0]));
  if (!db) return zeros;

  const baseWhere = [], baseArgs = [];
  if (city) { baseWhere.push('city LIKE ? COLLATE NOCASE'); baseArgs.push(`%${String(city).trim()}%`); }

  const seedSql = `
    SELECT category, COUNT(*) AS n
    FROM poi
    ${baseWhere.length ? 'WHERE ' + baseWhere.join(' AND ') : ''}
    GROUP BY category
  `;
  let seedRows = [];
  try { seedRows = await runSelect(db, seedSql, baseArgs); } catch { seedRows = []; }

  let userRows = [];
  try {
    const chk = await runSelect(db,
      `SELECT name FROM sqlite_master WHERE type='table' AND name='poi_user'`, []);
    if ((chk?.length || 0) > 0) {
      const userSql = `
        SELECT category, COUNT(*) AS n
        FROM poi_user
        ${baseWhere.length ? 'WHERE ' + baseWhere.join(' AND ') : ''}
        GROUP BY category
      `;
      userRows = await runSelect(db, userSql, baseArgs);
    }
  } catch { userRows = []; }

  const out = { ...zeros };
  [...seedRows, ...userRows].forEach(r => {
    const key = String(r?.category || '').trim();
    if (out[key] != null) out[key] += Number(r?.n || 0);
  });

  const total = Object.values(out).reduce((a,b)=>a+b,0);
  if (total === 0) {
    if (__DEV__) console.log('[poiHybrid] counts fallback → derived keywords');
    return await getCategoryCountsDerived({ country, city });
  }
  return out;
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
  const wantCat = category && MAP_CATEGORIES.includes(category) ? category : null;

  const first = await queryPoi({ country, city, category: wantCat, q: qTrim, limit: limit });
  let localItems = (first?.rows || []).map(r => toItem(r, r.source || 'local', wantCat));

  if (qTrim.length >= 2 && localItems.length) return localItems.slice(0, limit);

  const NEED_JS_FILTER = wantCat && localItems.length < limit;

  if (NEED_JS_FILTER) {
    const second = await queryPoi({ country, city, category: undefined, q: qTrim ? '' : '', limit: 400 });
    let pool = (second?.rows || []).map(r => toItem(r, r.source || 'local'));
    if (pool.length === 0 && city) {
      const third = await queryPoi({ country, city: undefined, category: undefined, q: '', limit: 1000 });
      pool = (third?.rows || []).map(r => toItem(r, r.source || 'local'));
      if (__DEV__) console.log('[poiHybrid] list fallback to country-wide pool for JS category filter');
    }
    const filtered = pool.filter(x => (x?.category || inferCategory(x)) === wantCat);
    const filteredByQ = qTrim.length >= 2
      ? filtered.filter(x => (`${x.name} ${x.address}`).toLowerCase().includes(qTrim.toLowerCase()))
      : filtered;
    const merged = mergeUniq(localItems, filteredByQ);
    return merged.slice(0, limit);
  }

  if (qTrim.length < 2 && localItems.length === 0 && city) {
    const second = await queryPoi({ country, city: undefined, category: wantCat, q: '', limit });
    localItems = (second?.rows || []).map(r => toItem(r, r.source || 'local', wantCat));
    if (localItems.length) {
      if (__DEV__) console.log('[poiHybrid] list fallback to no-city for category:', wantCat, 'city was:', city);
    }
  }

  if (wantCat && localItems.length < limit) {
    const third = await queryPoi({ country, city: undefined, category: undefined, q: '', limit: 1000 });
    const pool = (third?.rows || []).map(r => toItem(r, r.source || 'local'));
    const filtered = pool.filter(x => (x?.category || inferCategory(x)) === wantCat);
    const merged = mergeUniq(localItems, filtered);
    return merged.slice(0, limit);
  }

  return localItems.slice(0, limit);
}

/* --------------------------------------------------------------------------
 * GOOGLE FETCH
 * -------------------------------------------------------------------------- */
async function searchGoogleOnce(qTrim, {
  lat, lon, city, category, limit = 10, sessionToken, timeoutMs
}) {
  const toG = (r) => toItem(r, 'google', category || 'sights');

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
 * -------------------------------------------------------------------------- */
export async function searchPoiHybridThreshold({
  country = DEFAULT_COUNTRY,
  city,
  category,
  q = '',
  limit = 50,
  center,
  minLocal = 3,
  sessionToken,
  timeoutMs,
} = {}) {
  const qTrim = (q || '').trim();
  const local = await searchPoiLocal({ country, city, category, q: qTrim, limit });

  if (!qTrim) return local.slice(0, Math.max(20, Math.min(limit, 50)));
  if (local.length >= minLocal) return local.slice(0, limit);

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

export async function searchPoiHybrid(opts = {}) {
  const local = await searchPoiLocal(opts);
  const qTrim = (opts?.q || '').trim();
  if (!qTrim) return local;
  const lat = Number(opts?.center?.lat);
  const lon = Number(opts?.center?.lon ?? opts?.center?.lng);
  const remote = await searchGoogleOnce(qTrim, {
    lat, lon, city: opts?.city, category: opts?.category, limit: 12, sessionToken: opts?.sessionToken,
  });
  return mergeUniq(local, remote).slice(0, Number(opts?.limit) || 50);
}
