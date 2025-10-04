// trips/services/placeResolver.js
import { poiMatch, poiSearch, poiMatchUpsert } from '../../app/lib/api';
import { addUserPoi } from '../../app/lib/poiHybrid';

/* ------------------------- numeric/geo helpers ------------------------- */
const round5 = (x) => Math.round(Number(x) * 1e5) / 1e5;
const toRad = (d) => (d * Math.PI) / 180;
const haversineKm = (a, b) => {
  if (!a || !b) return Infinity;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad((b.lng ?? b.lon) - (a.lng ?? a.lon));
  const s1 = toRad(a.lat);
  const s2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(s1) * Math.cos(s2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/* -------------------------- string helpers ----------------------------- */
const stripBrackets = (s = '') =>
  String(s).replace(/\s*[\(\[\{].*?[\)\]\}]\s*/g, ' ').replace(/\s+/g, ' ').trim();

const removeSuffixes = (s = '') => {
  const kill = [
    'restaurant','restoran','cafe','kafe','pastane','patisserie','bakery',
    'bar','pub','coffee','kahve','lokanta','büfe','bufe','branch','şubesi','sube',
    'ankara','istanbul','izmir'
  ];
  let t = String(s || '').toLowerCase();
  t = t.replace(/[-–—•|]+/g, ' ');
  for (let i = 0; i < 3; i++) t = t.replace(new RegExp(`\\b(${kill.join('|')})\\b`, 'g'), ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length ? t : String(s || '').toLowerCase();
};

const trFold = (s = '') => {
  const str = String(s || '');
  try {
    return str
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch => ({ İ:'I', I:'I', ı:'i', Ş:'S', ş:'s', Ğ:'G', ğ:'g', Ü:'U', ü:'U', Ö:'O', ö:'O', Ç:'C', ç:'C' }[ch] || ch))
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return str
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch => ({ İ:'I', I:'I', ı:'i', Ş:'S', ş:'s', Ğ:'G', ğ:'g', Ü:'U', ü:'U', Ö:'O', ö:'O', Ç:'C', ç:'C' }[ch] || ch))
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
};

const normName = (s = '') => trFold(removeSuffixes(stripBrackets(s)));
const keyForClient = (name, coords) =>
  `${trFold(String(name || ''))}@${round5(coords.lat)},${round5(coords.lng)}`;

const ngrams = (s, n = 3) => {
  const t = ` ${s} `;
  const out = [];
  for (let i = 0; i <= t.length - n; i++) out.push(t.slice(i, i + n));
  return out;
};
const trigramSim = (a, b) => {
  const A = new Set(ngrams(a, 3));
  const B = new Set(ngrams(b, 3));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.max(A.size, B.size);
};

/* ------------------------------- tunables ------------------------------- */
const NAME_SIM_WEIGHT = 0.65;
const PROX_WEIGHT = 0.35;
const NAME_SIM_THRESHOLD = 0.35;
const MAX_NEAR_KM = 10;
const GOOGLE_TEXT_FALLBACK = true;
const FALLBACK_TIMEOUT_MS = 9000;
const CONCURRENCY = 6;

/* -------------------------------- scoring -------------------------------- */
const scoreCandidate = (qName, qCoord, cand) => {
  const sim = trigramSim(normName(qName), normName(cand.name || ''));
  let prox = 0;
  if (qCoord && cand.coords) {
    const d = haversineKm(qCoord, cand.coords);
    prox = Math.max(0, 1 - Math.min(d, MAX_NEAR_KM) / MAX_NEAR_KM);
  }
  return NAME_SIM_WEIGHT * sim + PROX_WEIGHT * prox;
};

/* -------------------------- normalize incoming item --------------------- */
export function normalizeRaw(item) {
  const lat = Number(item?.lat ?? item?.coords?.lat);
  const lon = Number(item?.lon ?? item?.coords?.lng ?? item?.coords?.lon);
  const coords =
    Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lng: lon } : null;

  const category =
    item.category || item.amenity || item.tourism || item.shop || 'sights';

  return {
    id:
      item.id ||
      item.osm_id ||
      item.place_id ||
      `${item.source || 'x'}:${item.name || ''}:${lat},${lon}`,
    source: item.source || (item.place_id ? 'google' : 'osm'),
    name: item.name || '—',
    place_id: item.place_id || null,
    coords,
    _seed_coords: coords || null,
    resolved: !!item.place_id,
    opening_hours: item.opening_hours || null,
    rating: item.rating ?? null,
    user_ratings_total: item.user_ratings_total ?? null,
    price_level: item.price_level ?? null,
    osm_id: item.osm_id ?? item.id ?? null,
    address: item.address || item.formatted_address || item.description || '',
    city: item.city || '',
    // ⬇️ yeni: DB eşleşmesi için item_id (unique seed id)
    item_id: item.item_id || item.id || item.osm_id || null,
  };
}

/* -------------------------- tiny concurrency limiter -------------------- */
function createLimiter(concurrency = 6) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (!queue.length || active >= concurrency) return;
    const { fn, resolve, reject } = queue.shift();
    active++;
    Promise.resolve()
      .then(fn)
      .then((v) => { active--; resolve(v); next(); })
      .catch((e) => { active--; reject(e); next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
const limit = createLimiter(CONCURRENCY);

/* ------------------------------- query cache ---------------------------- */
const qCache = new Map();
const cacheKey = (q, o) => `${q}|${o.lat}|${o.lon}|${o.city}|${o.category || ''}`;
async function cachedPoiSearch(q, opts) {
  const key = cacheKey(q, opts);
  if (qCache.has(key)) return qCache.get(key);
  const arr = await poiSearch(q, opts);
  qCache.set(key, arr || []);
  return arr || [];
}

/* ------------------------ early-stop text-search chain ------------------ */
async function textSearchCascade({ name, city, lat, lon, category, timeoutMs = FALLBACK_TIMEOUT_MS }) {
  const primary = `${name} ${city}`.trim();
  const variants = [
    { q: primary,                               category: undefined },
    { q: `${category || ''} ${primary}`.trim(), category },
    { q: `${name}`.trim(),                      category: undefined },
  ];

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const res = await cachedPoiSearch(v.q, {
      lat: round5(lat),
      lon: round5(lon),
      city,
      category: v.category,
      timeoutMs,
    });
    if (res && res.length) return res;
  }
  return [];
}

/* --------------------------------- single -------------------------------- */
export async function resolveSingle({ item, city = '' }) {
  const [x] = await resolvePlacesBatch({ items: [item], city });
  return x;
}

/* --------------------------------- batch --------------------------------- */
export async function resolvePlacesBatch({ items, city = '' }) {
  const normalized = (items || []).map(normalizeRaw);

  // 1) DB batch match — sadece DB (kesin), Google’a gitme
  const need = normalized.filter((x) => !x.place_id && x.coords && x.name);
  if (need.length) {
    try {
      const payload = need.map((x) => ({
        item_id: x.item_id || x.id || x.osm_id || undefined,
        osm_id: x.osm_id,
        name: x.name,
        lat: round5(x._seed_coords?.lat ?? x.coords.lat),
        lon: round5(x._seed_coords?.lng ?? x.coords.lng),
      }));
      const json = await poiMatch(payload, city);
      const byKey = new Map(
        (json?.results || []).map((m) => {
          const lat5 = round5(m.lat ?? m?.coords?.lat);
          const lon5 = round5(m.lon ?? m?.coords?.lon ?? m?.coords?.lng);
          const key = m.key || keyForClient(m.name || '', { lat: lat5, lng: lon5 });
          return [key, m];
        })
      );

      for (const x of normalized) {
        if (x.place_id || !x.coords) continue;
        const key = keyForClient(x.name, { lat: x._seed_coords?.lat ?? x.coords.lat, lng: x._seed_coords?.lng ?? x.coords.lng });
        const m = byKey.get(key);
        if (m?.matched && m.place_id) {
          x.place_id = m.place_id;
          x.resolved = true;
          x.opening_hours = m.opening_hours || x.opening_hours || null;
          x.rating = m.rating ?? x.rating ?? null;
          // Google koordinatı varsa UI için kullan
          if (Number.isFinite(Number(m.g_lat)) && Number.isFinite(Number(m.g_lon))) {
            x._google_coords = { g_lat: Number(m.g_lat), g_lon: Number(m.g_lon) };
            x.coords = { lat: Number(m.g_lat), lng: Number(m.g_lon) };
            x.lat    = x.coords.lat;
            x.lon    = x.coords.lng;
          }
          x._resolved_by = 'cache';
        }
      }
    } catch (e) {
      console.warn('[placeResolver] batch match error', e?.message || e);
    }
  }

  // 2) Google fallback → sadece DB’de eşleşmeyenler için
  if (GOOGLE_TEXT_FALLBACK) {
    const unresolved = normalized.filter((x) =>
      !x.place_id && x.coords && x.name && String(x.name).trim().length > 1
    );

    if (unresolved.length) {
      const jobs = unresolved.map((x) =>
        limit(async () => {
          try {
            const hits = await textSearchCascade({
              name: String(x.name || ''),
              city: String(city || ''),
              lat: x.coords.lat,
              lon: x.coords.lng,
              category: x.category || '',
              timeoutMs: FALLBACK_TIMEOUT_MS,
            });
            if (!hits.length) { x._resolve = { status: 'no_match' }; return; }

            const seen = new Set();
            const cands = [];
            for (const c of hits) {
              const pid = c?.place_id;
              if (!pid || seen.has(pid)) continue;
              seen.add(pid);
              const la = Number(c.lat);
              const lo = Number(c.lon);
              cands.push({
                name: c.name || '—',
                place_id: pid,
                coords: Number.isFinite(la) && Number.isFinite(lo) ? { lat: la, lng: lo } : null,
                opening_hours: c.opening_hours || null,
                rating: c.rating ?? null,
                user_ratings_total: c.user_ratings_total ?? null,
                price_level: c.price_level ?? null,
                address: c.address || c.formatted_address || '',
              });
            }

            let best = null, bestScore = -1;
            for (const cand of cands) {
              const sc = scoreCandidate(x.name, x.coords, cand);
              if (sc > bestScore) { best = cand; bestScore = sc; }
            }

            if (best && best.place_id && bestScore >= NAME_SIM_THRESHOLD) {
              x.place_id = best.place_id;
              x.resolved = true;
              x.opening_hours = best.opening_hours || x.opening_hours || null;
              x.rating = best.rating ?? x.rating ?? null;
              x.user_ratings_total = best.user_ratings_total ?? x.user_ratings_total ?? null;
              x.price_level = best.price_level ?? x.price_level ?? null;
              if (best.coords) {
                x._google_coords = { g_lat: best.coords.lat, g_lon: best.coords.lng };
                x.coords = { lat: best.coords.lat, lng: best.coords.lng };
                x.lat    = x.coords.lat;
                x.lon    = x.coords.lng;
              }
              if (best.address && !x.address) x.address = best.address;
              x._resolve = { status: 'matched', score: bestScore };
              x._resolved_by = 'google_fallback';
            } else {
              x._resolve = { status: 'no_good_match', tried: cands.length, bestScore };
            }
          } catch (e) {
            console.warn('[placeResolver] fuzzy fallback error', x.name, e?.message || e);
            x._resolve = { status: 'error', message: e?.message || String(e) };
          }
        })
      );

      await Promise.all(jobs);
    }
  }

  // 3) DB’ye upsert — anahtar için seed coord; ayrı alan olarak Google coord
  try {
    const toUpsert = normalized
      .filter(x => x.resolved && x.place_id && x._seed_coords)
      .map(x => ({
        item_id: x.item_id || x.id || x.osm_id || undefined, // ⬅️ benzersiz seed id
        name: x.name,
        lat: x._seed_coords.lat,
        lon: x._seed_coords.lng,
        city,
        place_id: x.place_id,
        rating: x.rating ?? null,
        hours: x.opening_hours ?? null,
        ...(x._google_coords ? {
          g_lat: x._google_coords.g_lat,
          g_lon: x._google_coords.g_lon
        } : null),
      }));
    if (toUpsert.length) await poiMatchUpsert(toUpsert);
  } catch (e) {
    if (__DEV__) console.warn('[placeResolver] upsert error', e?.message || e);
  }

  // 4) User overlay’e yaz — sadece seçmeli (UI deneyimi)
  try {
    const overlayJobs = normalized
      .filter(x => x.resolved && x.place_id && x.coords)
      .map(async (x) => {
        await addUserPoi({
          country: 'TR',
          city: x.city || city || '',
          category: x.category || 'sights',
          name: x.name || '',
          lat: x.coords.lat,
          lon: x.coords.lng,
          address: x.address || '',
          place_id: x.place_id,
        });
      });
    if (overlayJobs.length) await Promise.allSettled(overlayJobs);
  } catch (e) {
    if (__DEV__) console.warn('[placeResolver] addUserPoi overlay error', e?.message || e);
  }

  return normalized;
}

export default { normalizeRaw, resolveSingle, resolvePlacesBatch };
