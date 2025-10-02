// trips/services/placeResolver.js
// -------------------------------------------------------------
// Robust POI Resolver (entegre: early-stop cascade + cache + concurrency)
// 1) Normalize
// 2) Server-side batch match (/api/poi/match)
// 3) Fuzzy fallback (tek kademeli zincir, erken durdurma, cache, limitli paralellik)
// -------------------------------------------------------------

import { poiMatch, poiSearch } from '../../app/lib/api';

/* ------------------------- helpers: numeric/geo ------------------------- */
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

/* -------------------------- helpers: string fold ------------------------ */
const stripBrackets = (s = '') =>
  s.replace(/\s*[\(\[\{].*?[\)\]\}]\s*/g, ' ').replace(/\s+/g, ' ').trim();

const removeSuffixes = (s = '') => {
  const kill = [
    'restaurant','restoran','cafe','kafe','pastane','patisserie','bakery',
    'bar','pub','coffee','kahve','lokanta','büfe','bufe','branch','şubesi','sube',
    'ankara','istanbul','izmir'
  ];
  let t = s.toLowerCase();
  t = t.replace(/[-–—•|]+/g, ' ');
  for (let i = 0; i < 3; i++) t = t.replace(new RegExp(`\\b(${kill.join('|')})\\b`, 'g'), ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length ? t : s.toLowerCase();
};

const trFold = (s = '') =>
  String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[İIıŞşĞğÜüÖöÇç]/g, (ch) => ({
      İ: 'I', I: 'I', ı: 'i', Ş: 'S', ş: 's', Ğ: 'G', ğ: 'g', Ü: 'U', ü: 'U', Ö: 'O', ö: 'O', Ç: 'C', ç: 'C'
    }[ch] || ch))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const normName = (s = '') => trFold(removeSuffixes(stripBrackets(s)));

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
const NAME_SIM_THRESHOLD = 0.35;   // fuzzy eşik
const MAX_NEAR_KM = 10;            // proximity normalizasyon üst sınır
const GOOGLE_TEXT_FALLBACK = true;
const FALLBACK_TIMEOUT_MS = 9000;
const CONCURRENCY = 6;

/* ----------------------------- scoring logic ---------------------------- */
const scoreCandidate = (qName, qCoord, cand) => {
  const sim = trigramSim(normName(qName), normName(cand.name || ''));
  let prox = 0;
  if (qCoord && cand.coords) {
    const d = haversineKm(qCoord, cand.coords);
    // 0..1 aralığına sıkıştır (0 = uzak, 1 = aynı nokta)
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
    category,
    resolved: !!item.place_id,
    opening_hours: item.opening_hours || null,
    rating: item.rating ?? null,
    user_ratings_total: item.user_ratings_total ?? null,
    price_level: item.price_level ?? null,
    osm_id: item.osm_id ?? item.id ?? null, // eşlemede yedek anahtar
  };
}

/* -------------------------- tiny concurrency limiter -------------------- */
/** p-limit benzeri mini limiter: limit(fn) -> Promise */
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
const qCache = new Map(); // key -> results[]
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
  // Diakritikleri KORU (Google tarafında daha iyi recall); scoring'de normalize ediyoruz.
  const primary = `${name} ${city}`.trim();
  const variants = [
    { q: primary,                          category: undefined }, // 1) name + city
    { q: `${category || ''} ${primary}`.trim(), category },      // 2) category + name + city
    { q: `${name}`.trim(),                 category: undefined }, // 3) yalnız name
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
    if (res && res.length) return res; // erken durdur
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

  // 1) Server-side batch match — sadece place_id olmayan ve koordinatı olanlar
  const need = normalized.filter((x) => !x.place_id && x.coords);
  if (need.length) {
    try {
      const payload = need.map((x) => ({
        osm_id: x.osm_id,
        name: x.name,
        lat: round5(x.coords.lat), // client & server aynı rounding
        lon: round5(x.coords.lng),
      }));

      // app/lib/api.js → poiMatch serverAvailable değilse {results: []} döner
      const json = await poiMatch(payload, city);
      const byKey = new Map(
        (json?.results || []).map((m) => {
          const lat5 = round5(m.lat ?? m?.coords?.lat);
          const lon5 = round5(m.lon ?? m?.coords?.lon ?? m?.coords?.lng);
          const key = m.osm_id ?? `${normName(m.name || '')}@${lat5},${lon5}`;
          return [key, m];
        })
      );

      for (const x of normalized) {
        if (x.place_id || !x.coords) continue;
        const key = x.osm_id ?? `${normName(x.name)}@${round5(x.coords.lat)},${round5(x.coords.lng)}`;
        const m = byKey.get(key);
        if (m?.matched && m.place_id) {
          x.place_id = m.place_id;
          x.resolved = true;
          x.opening_hours = m.opening_hours || x.opening_hours || null;
          x.rating = m.rating ?? x.rating ?? null;
          x.user_ratings_total = m.user_ratings_total ?? x.user_ratings_total ?? null;
          x.price_level = m.price_level ?? x.price_level ?? null;
        }
      }
    } catch (e) {
      console.warn('[placeResolver] batch match error', e?.message || e);
    }
  }

  // 2) Fuzzy fallback — tek zincir + erken durdurma + cache + paralellik limiti
  if (GOOGLE_TEXT_FALLBACK) {
    const unresolved = normalized.filter((x) => !x.place_id && x.coords && x.name && String(x.name).trim().length > 1);

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

          if (!hits.length) {
            x._resolve = { status: 'no_match' };
            return;
          }

          // normalize unique candidates by place_id
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
            });
          }

          // skorla ve en iyiyi uygula
          let best = null;
          let bestScore = -1;
          for (const cand of cands) {
            const sc = scoreCandidate(x.name, x.coords, cand);
            if (sc > bestScore) {
              best = cand;
              bestScore = sc;
            }
          }

          if (best && best.place_id && bestScore >= NAME_SIM_THRESHOLD) {
            x.place_id = best.place_id;
            x.resolved = true;
            x.opening_hours = best.opening_hours || x.opening_hours || null;
            x.rating = best.rating ?? x.rating ?? null;
            x.user_ratings_total = best.user_ratings_total ?? x.user_ratings_total ?? null;
            x.price_level = best.price_level ?? x.price_level ?? null;
            x._resolve = { status: 'matched', score: bestScore };
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

  return normalized;
}

export default { normalizeRaw, resolveSingle, resolvePlacesBatch };
