// server/routes/poi.js
const express = require('express');
const axios = require('axios');
const http = require('http');
const https = require('https');

const router = express.Router();

/* -------------------- Google API Key -------------------- */
const PLACES_KEY =
  process.env.GOOGLE_PLACES_KEY ||
  process.env.PLACES_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  '';

if (!PLACES_KEY) {
  console.warn('[POI] Google Places API key YOK (GOOGLE_PLACES_KEY / PLACES_API_KEY / GOOGLE_MAPS_API_KEY).');
} else {
  const masked = PLACES_KEY.slice(0, 6) + '...' + PLACES_KEY.slice(-4);
  console.log('[POI] Google key yüklendi:', masked);
}

/* -------------------- Google Endpoints -------------------- */
const TEXTSEARCH_URL   = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const DETAILS_URL      = 'https://maps.googleapis.com/maps/api/place/details/json';

/* -------------------- Axios (Keep-Alive) -------------------- */
const httpAgent  = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const httpClient = axios.create({
  timeout: Number(process.env.GOOGLE_TIMEOUT_MS || 12000), // 12s
  headers: { 'User-Agent': 'trip-planner/1.0' },
  httpAgent,
  httpsAgent,
});

/* -------------------- Utils -------------------- */
const asNum = (v, def = undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

/* --------- Basit bellek cache (HIT/MISS göstergeli) --------- */
const cache = new Map(); // key -> { data, exp }
const getC = (k) => {
  const v = cache.get(k);
  if (!v) return null;
  if (v.exp < Date.now()) { cache.delete(k); return null; }
  return v.data;
};
const setC = (k, data, ttlMs) => {
  cache.set(k, { data, exp: Date.now() + ttlMs });
};

/* -------------------- Sağlık -------------------- */
router.get('/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

/* ===================================================================
   GET /api/poi/google/autocomplete
   q, lat, lon, city, limit, sessiontoken
   =================================================================== */
router.get('/google/autocomplete', async (req, res) => {
  try {
    if (!PLACES_KEY) return res.status(400).json({ error: 'missing_api_key' });

    const { q = '', city = '', limit = '8', sessiontoken } = req.query;
    const lat = asNum(req.query.lat, null);
    const lon = asNum(req.query.lon, null);

    const akey = `ac:${String(q).trim()}|${city}|${lat}|${lon}|${limit}|${sessiontoken || ''}`;
    const cached = getC(akey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Google-Count', String(cached.length || 0));
      return res.json(cached);
    }

    const params = {
      input: String(q).trim(),
      key: PLACES_KEY,
      language: 'tr',
      region: 'TR',
      types: 'establishment',
    };
    if (lat != null && lon != null) { params.location = `${lat},${lon}`; params.radius = 30000; }
    if (sessiontoken) params.sessiontoken = sessiontoken;

    const g = await httpClient.get(AUTOCOMPLETE_URL, { params });
    const preds = Array.isArray(g.data?.predictions) ? g.data.predictions : [];
    const out = preds.slice(0, Number(limit) || 8).map(p => ({
      source: 'google',
      name: p?.structured_formatting?.main_text || p?.description || '',
      place_id: p?.place_id,
      address: p?.description || '',
      city,
    }));

    setC(akey, out, 6 * 60 * 60 * 1000); // 6 saat
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Google-Count', String(out.length));
    res.json(out);
  } catch (err) {
    if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'google_timeout' });
    res.status(err.response?.status || 502).json(err.response?.data || { error: 'google_proxy_error' });
  }
});

/* ===================================================================
   GET /api/poi/google/search
   q, lat, lon, city, category
   =================================================================== */
router.get('/google/search', async (req, res) => {
  const t0 = Date.now();
  try {
    if (!PLACES_KEY) return res.status(400).json({ error: 'missing_api_key' });

    const q = (req.query.q || '').toString().trim();
    const city = (req.query.city || '').toString().trim();
    const category = (req.query.category || '').toString().trim();
    const lat = asNum(req.query.lat, null);
    const lon = asNum(req.query.lon, null);

    const parts = [];
    if (category) parts.push(category);
    if (q) parts.push(q);
    if (city) parts.push(city);
    const queryStr = parts.join(' ').trim() || 'tourist attractions';

    const ckey = `ts:${queryStr}|${lat}|${lon}`;
    const cached = getC(ckey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Google-Count', String(cached.length || 0));
      return res.status(200).json(cached);
    }

    const params = {
      query: queryStr,
      key: PLACES_KEY,
      language: 'tr',
      region: 'TR',
    };
    if (lat != null && lon != null) {
      params.location = `${lat},${lon}`;
      // params.radius = 30000; // TextSearch'te resmi değil, Nearby için anlamlıdır.
    }

    const g = await httpClient.get(TEXTSEARCH_URL, { params });
    const data = g.data || {};
    const results = Array.isArray(data.results) ? data.results : [];

    const out = results.map((r) => ({
      source: 'google',
      name: r.name || '',
      place_id: r.place_id,
      lat: r.geometry?.location?.lat,
      lon: r.geometry?.location?.lng,
      rating: r.rating,
      user_ratings_total: r.user_ratings_total,
      price_level: r.price_level,
      address: r.formatted_address || r.vicinity || '',
      opening_hours: r.opening_hours,
      types: r.types || [],
    }));

    setC(ckey, out, 6 * 60 * 60 * 1000); // 6 saat
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Google-Count', String(out.length));
    return res.status(200).json(out);
  } catch (err) {
    const ms = Date.now() - t0;
    console.error('[google/search] error', err?.code || err?.name || err, `after ${ms}ms`);
    if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'google_timeout' });
    const status = err.response?.status || 502;
    const body = err.response?.data || { error: 'google_proxy_error' };
    return res.status(status).json(body);
  }
});

/* ===================================================================
   (Opsiyonel) GET /api/poi/google/details
   place_id, fields (virgüllü), sessiontoken
   =================================================================== */
router.get('/google/details', async (req, res) => {
  try {
    if (!PLACES_KEY) return res.status(400).json({ error: 'missing_api_key' });
    const place_id = (req.query.place_id || '').toString().trim();
    if (!place_id) return res.status(400).json({ error: 'missing_place_id' });

    const fields =
      (req.query.fields || 'place_id,name,geometry/location,opening_hours,rating,user_ratings_total,price_level,formatted_address').toString();

    const dkey = `dt:${place_id}|${fields}`;
    const cached = getC(dkey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Google-Count', '1');
      return res.json(cached);
    }

    const params = {
      place_id,
      fields,
      key: PLACES_KEY,
      language: 'tr',
      region: 'TR',
    };
    if (req.query.sessiontoken) params.sessiontoken = req.query.sessiontoken;

    const g = await httpClient.get(DETAILS_URL, { params });
    const result = g.data?.result || {};

    setC(dkey, result, 24 * 60 * 60 * 1000); // 24 saat
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Google-Count', '1');
    return res.json(result);
  } catch (err) {
    if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'google_timeout' });
    res.status(err.response?.status || 502).json(err.response?.data || { error: 'google_proxy_error' });
  }
});

/* ===================================================================
   POST /api/poi/match  -> "exact-ish" koordinat + isim normalize eşleştirme (stub)
   body: { items: [{osm_id, name, lat, lon, city}], ... }
   =================================================================== */
router.post('/match', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    const round5 = (x) => (typeof x === 'number' ? Math.round(x * 1e5) / 1e5 : null);
    const results = items.map((it) => ({
      key: `${(it.name || '').trim()}@${round5(it.lat)},${round5(it.lon)}`,
      matched: false,
      place_id: null,
    }));

    return res.status(200).json({ results });
  } catch (err) {
    console.error('[poi/match] error', err?.message || err);
    return res.status(500).json({ error: 'match_failed' });
  }
});

module.exports = router;
