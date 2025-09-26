// server/routes/poi.js
const express = require('express');
const router = express.Router();

// Google Places API anahtarı (Render'da env olarak ekle)
const API_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_PLACES_KEY ||
  process.env.GOOGLE_PLACES_API_KEY;

/* -------------------- küçük yardımcılar -------------------- */
const now = () => Date.now();
function okArray(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.predictions)) return v.predictions;
  if (v && Array.isArray(v.results)) return v.results;
  return [];
}
function safeAddress(p) {
  return p?.formatted_address || p?.vicinity || p?.description || p?.address || '';
}

// Basit LRU cache (+ TTL) ve in-flight dedupe
const TTL_MS = 60_000;
const CACHE_MAX = 500;
const cache = new Map();    // key -> {exp,val}
const inflight = new Map(); // key -> Promise

function setCache(k, v) {
  cache.set(k, { exp: now() + TTL_MS, val: v });
  if (cache.size > CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
}
function getCache(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (now() > e.exp) {
    cache.delete(k);
    return null;
  }
  return e.val;
}
async function oncePerKey(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Server-side fetch with timeout (Node 18+ global fetch)
async function fetchWithTimeout(url, ms = 2500, headers = {}) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { headers, signal: ac.signal });
  } finally {
    clearTimeout(to);
  }
}

/* ==================== AUTOCOMPLETE ==================== */
router.get('/google/autocomplete', async (req, res) => {
  const { q = '', lat, lon, city = '', limit = '8', sessiontoken } = req.query;

  if (!API_KEY) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY missing' });

  const qTrim = String(q || '').trim();
  if (qTrim.length < 2) {
    res.set('X-Cache', 'BYPASS');
    return res.json([]);
  }

  const params = new URLSearchParams({
    input: qTrim,
    key: API_KEY,
    language: 'tr',
    region: 'TR',
    types: 'establishment',
  });
  if (lat && lon) {
    params.set('location', `${lat},${lon}`);
    params.set('radius', '30000');
  }
  if (sessiontoken) params.set('sessiontoken', String(sessiontoken));

  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`;
  const cacheKey = `ac|${url}`;
  const t0 = now();

  const cached = getCache(cacheKey);
  if (cached) {
    res.set('X-Cache', 'HIT');
    res.set('X-Google-Count', String(cached.length || 0));
    res.set('X-RTT-MS', '0');
    return res.json(cached);
  }

  try {
    const tFetch0 = now();
    const r = await fetchWithTimeout(url, 2500, { Accept: 'application/json' });
    const tFetch1 = now();
    const j = await r.json();
    const status = j?.status || 'OK';
    const preds = okArray(j);

    const out = preds.slice(0, Number(limit) || 8).map(p => ({
      source: 'google',
      name: p?.structured_formatting?.main_text || p?.description || p?.name || '',
      place_id: p?.place_id,
      address: p?.description || '',
      // lat/lon detaysız autocomplete'te yok; seçilince details ile alınır
      city,
      types: p?.types,
    }));

    setCache(cacheKey, out);
    res.set('X-Cache', 'MISS');
    res.set('X-Google-Count', String(out.length));
    res.set('X-Google-Status', status);
    res.set('X-Upstream-MS', String(tFetch1 - tFetch0));
    res.set('X-RTT-MS', String(now() - t0));
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(out);
  } catch (err) {
    console.error('[AUTOCOMPLETE] error:', err?.name, err?.message || err);
    res.set('X-Cache', 'ERROR');
    res.set('X-RTT-MS', String(now() - t0));
    return res.json([]); // her durumda dizi dön
  }
});

/* ==================== SEARCH (TextSearch) ==================== */
router.get('/google/search', async (req, res) => {
  const { q = '', lat, lon, city = '', category = '' } = req.query;

  if (!API_KEY) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY missing' });

  const params = new URLSearchParams({
    query: String(q || ''),
    key: API_KEY,
    language: 'tr',
    region: 'TR',
  });
  if (lat && lon) {
    params.set('location', `${lat},${lon}`);
    params.set('radius', '30000');
  }
  if (category) params.set('type', category);

  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
  const cacheKey = `ts|${url}`;
  const t0 = now();

  const cached = getCache(cacheKey);
  if (cached) {
    res.set('X-Cache', 'HIT');
    res.set('X-Google-Count', String(cached.length || 0));
    res.set('X-RTT-MS', '0');
    return res.json(cached);
  }

  try {
    const tFetch0 = now();
    const r = await fetchWithTimeout(url, 3000, { Accept: 'application/json' });
    const tFetch1 = now();
    const j = await r.json();
    const arr = okArray(j).map(x => ({
      source: 'google',
      name: x?.name || '',
      lat: x?.geometry?.location?.lat,
      lon: x?.geometry?.location?.lng,
      place_id: x?.place_id,
      address: safeAddress(x),
      types: x?.types,
      city,
    }));

    setCache(cacheKey, arr);
    res.set('X-Cache', 'MISS');
    res.set('X-Google-Count', String(arr.length));
    res.set('X-Upstream-MS', String(tFetch1 - tFetch0));
    res.set('X-RTT-MS', String(now() - t0));
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(arr);
  } catch (err) {
    console.error('[SEARCH] error:', err?.name, err?.message || err);
    res.set('X-Google-Count', '0');
    res.set('X-RTT-MS', String(now() - t0));
    return res.json([]);
  }
});

module.exports = router;
