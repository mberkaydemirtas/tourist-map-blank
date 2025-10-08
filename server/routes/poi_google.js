// server/routes/poi_google.js
const express = require('express');
const router = express.Router();

let _fetch = global.fetch;
if (typeof _fetch !== 'function') {
  try { _fetch = require('node-fetch'); } catch {}
}
const fetch = _fetch;

const { upsertSuggests } = require('../lib/suggestDB');

// --- ENV'i her istekte oku (require zamanında değil) ---
function getGoogleKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || '';
}
const GOOGLE_TIMEOUT_MS = Number(process.env.GOOGLE_TIMEOUT_MS || 9000);

const ENRICH_TOP = 5;

function isFiniteNum(v){ return Number.isFinite(Number(v)); }
function toNum(v){ const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function withTimeout(p, ms, label='timeout'){ return Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error(`${label}_${ms}`)), ms))]); }
async function fetchJson(url, opts={}, t=GOOGLE_TIMEOUT_MS){
  const res = await withTimeout(fetch(url, opts), t, 'google');
  if (!res.ok){
    const txt = await res.text().catch(()=> '');
    const err = new Error(`fetch_fail_${res.status}`);
    err.status = res.status; err.body = txt;
    throw err;
  }
  return res.json();
}

/* ---------------- Autocomplete ---------------- */
async function handleAutocomplete(req, res){
  const GOOGLE_KEY = getGoogleKey();
  const q = String(req.query.q || '').trim();
  const city = String(req.query.city || '');
  const lat = toNum(req.query.lat);
  const lon = toNum(req.query.lon);
  const limit = Math.max(1, Math.min(12, Number(req.query.limit) || 8));
  const sessiontoken = String(req.query.sessiontoken || '');

  console.log('[AC] hit', req.path, `q="${q}" city="${city}" key?=${GOOGLE_KEY ? 'yes':'no'}`);

  if (!GOOGLE_KEY) return res.status(500).json({ error: 'google_key_missing' });
  if (!q || q.length < 2) return res.json({ results: [] });

  try {
    // Predictions
    const acUrl = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
    acUrl.searchParams.set('input', q);
    acUrl.searchParams.set('key', GOOGLE_KEY);
    if (isFiniteNum(lat) && isFiniteNum(lon)) {
      acUrl.searchParams.set('location', `${lat},${lon}`);
      acUrl.searchParams.set('radius', '25000');
    }
    if (sessiontoken) acUrl.searchParams.set('sessiontoken', sessiontoken);

    const acJson = await fetchJson(String(acUrl));
    const predictions = Array.isArray(acJson?.predictions) ? acJson.predictions.slice(0, limit) : [];
    if (!predictions.length) {
      console.warn('[AC] no predictions; status:', acJson?.status);
    }

    // Details (ilk N)
    const enriched = [];
    for (const p of predictions.slice(0, ENRICH_TOP)) {
      try {
        const detUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
        detUrl.searchParams.set('place_id', p.place_id);
        detUrl.searchParams.set('fields','place_id,name,geometry,formatted_address,types,rating,user_ratings_total,price_level');
        detUrl.searchParams.set('key', GOOGLE_KEY);
        if (sessiontoken) detUrl.searchParams.set('sessiontoken', sessiontoken);

        const dj = await fetchJson(String(detUrl));
        const r = dj?.result;
        const loc = r?.geometry?.location;
        if (!loc) {
          console.warn('[AC details] no geometry for', p.place_id, 'status=', dj?.status);
          continue;
        }

        enriched.push({
          source: 'google',
          provider: 'autocomplete',
          place_id: r.place_id,
          name: r.name,
          address: r.formatted_address || '',
          city,
          lat: Number(loc.lat),
          lon: Number(loc.lng),
          rating: isFiniteNum(r.rating) ? Number(r.rating) : null,
          user_ratings_total: isFiniteNum(r.user_ratings_total) ? Number(r.user_ratings_total) : null,
          price_level: isFiniteNum(r.price_level) ? Number(r.price_level) : null,
          types: Array.isArray(r.types) ? r.types : [],
        });
      } catch (e) {
        console.warn('[AC details warn]', e?.message || e);
      }
    }

    if (enriched.length) {
      try {
        upsertSuggests(enriched, { city, provider: 'autocomplete', source: 'google' });
        console.log('[AC persist] upserted', enriched.length);
      } catch (e) {
        console.warn('[persist warn] autocomplete upsert failed:', e?.message || e);
      }
    } else {
      console.warn('[AC persist] nothing to upsert (no enriched rows)');
    }

    const mapped = [
      ...enriched,
      ...predictions.slice(enriched.length).map(p => ({
        source: 'google',
        provider: 'autocomplete',
        place_id: p.place_id,
        name: p.structured_formatting?.main_text || p.description || '',
        address: p.description || '',
        city,
        types: [],
        rating: null,
        user_ratings_total: null,
        price_level: null,
      })),
    ];

    return res.json({ results: mapped });
  } catch (e) {
    console.error('[GOOGLE/AC] error', e?.status, e?.message, e?.body || '');
    const code = Number(e?.status) || 500;
    return res.status(code >= 400 && code < 600 ? code : 500).json({ error: 'ac_failed' });
  }
}

/* ---------------- Text Search (submit) ---------------- */
async function handleSearch(req, res){
  const GOOGLE_KEY = getGoogleKey();
  const q = String(req.query.q || '').trim();
  const city = String(req.query.city || '');
  const lat = toNum(req.query.lat);
  const lon = toNum(req.query.lon);
  const category = String(req.query.category || '');
  const isSubmit = req.get('x-submit-search') === '1' || String(req.query.submit || '') === '1';

  console.log('[SEARCH] hit', req.path, `q="${q}" city="${city}" submit=${isSubmit} key?=${GOOGLE_KEY ? 'yes':'no'}`);

  if (!GOOGLE_KEY) return res.status(500).json({ error: 'google_key_missing' });
  if (!q || q.length < 2) return res.json({ results: [] });
  if (!isSubmit) return res.status(204).end();

  try {
    const tsUrl = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    tsUrl.searchParams.set('query', q);
    tsUrl.searchParams.set('key', GOOGLE_KEY);
    if (isFiniteNum(lat) && isFiniteNum(lon)) {
      tsUrl.searchParams.set('location', `${lat},${lon}`);
      tsUrl.searchParams.set('radius', '25000');
    }
    if (category) tsUrl.searchParams.set('type', category);

    const js = await fetchJson(String(tsUrl));
    const list = Array.isArray(js?.results) ? js.results : [];
    if (!list.length) console.warn('[SEARCH] empty results; status:', js?.status);

    const mapped = list.map(r => ({
      source: 'google',
      provider: 'search',
      place_id: r.place_id,
      name: r.name,
      address: r.formatted_address || r.vicinity || '',
      city,
      lat: r?.geometry?.location?.lat,
      lon: r?.geometry?.location?.lng,
      rating: isFiniteNum(r.rating) ? Number(r.rating) : null,
      user_ratings_total: isFiniteNum(r.user_ratings_total) ? Number(r.user_ratings_total) : null,
      price_level: isFiniteNum(r.price_level) ? Number(r.price_level) : null,
      types: Array.isArray(r.types) ? r.types : [],
    })).filter(x => isFiniteNum(x.lat) && isFiniteNum(x.lon));

    if (mapped.length) {
      try {
        upsertSuggests(mapped, { city, provider: 'search', source: 'google' });
        console.log('[SEARCH persist] upserted', mapped.length);
      } catch (e) {
        console.warn('[persist warn] search upsert failed:', e?.message || e);
      }
    } else {
      console.warn('[SEARCH persist] nothing to upsert');
    }

    return res.json({ results: mapped });
  } catch (e) {
    console.error('[GOOGLE/SEARCH] error', e?.status, e?.message, e?.body || '');
    const code = Number(e?.status) || 500;
    return res.status(code >= 400 && code < 600 ? code : 500).json({ error: 'search_failed' });
  }
}

/* ---------------- routes (iki prefix) ---------------- */
router.get('/api/poi/google/autocomplete', handleAutocomplete);
router.get('/api/poi/google/search',       handleSearch);
router.get('/api/places/autocomplete',     handleAutocomplete);
router.get('/api/places/search',           handleSearch);

module.exports = router;
