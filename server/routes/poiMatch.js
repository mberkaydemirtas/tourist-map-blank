// server/routes/poiMatch.js
const express = require('express');
const router = express.Router();

const {
  canonicalName, round5, toRow, getManyByKey, getManyByItemId, upsertMany
} = require('../lib/matchDB');

// POST /api/poi/match  → batch lookup (DB’den oku, Google’a asla gitme)
router.post('/match', express.json({ limit: '256kb' }), (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.json({ results: [] });

    // key ve item_id birlikte kontrol (iki vektör)
    const keys = items.map(x => {
      const nm = canonicalName(String(x?.name || ''));
      const lat5 = round5(x?.lat);
      const lon5 = round5(x?.lon);
      return `${nm}@${lat5},${lon5}`;
    });
    const itemIds = items.map(x => x?.item_id || x?.osm_id || null).filter(Boolean);

    const byKeyRows = keys.length ? getManyByKey(keys) : [];
    const byIdRows  = itemIds.length ? getManyByItemId(itemIds) : [];

    // Merge önceliği: item_id > key (daha güvenilir)
    const byKeyMap = new Map(byKeyRows.map(r => [r.key, r]));
    const byIdMap  = new Map(byIdRows.map(r => [r.item_id, r]));

    const results = items.map((x, i) => {
      const nm = canonicalName(String(x?.name || ''));
      const lat5 = round5(x?.lat);
      const lon5 = round5(x?.lon);
      const key = `${nm}@${lat5},${lon5}`;
      const iid = x?.item_id || x?.osm_id || null;

      const byIdHit  = iid ? byIdMap.get(iid) : null;
      const byKeyHit = byKeyMap.get(key);

      const hit = byIdHit || byKeyHit || null;
      if (hit) {
        let hours = null;
        try { hours = hit.hours_json ? JSON.parse(hit.hours_json) : null; } catch {}
        const out = {
          matched: true,
          key,
          name: x?.name || '',
          place_id: hit.place_id,
          lat: lat5,
          lon: lon5,
          city: x?.city || null,
          rating: hit.rating ?? null,
          opening_hours: hours,
        };
        if (Number.isFinite(hit.g_lat5) && Number.isFinite(hit.g_lon5)) {
          out.g_lat = hit.g_lat5;
          out.g_lon = hit.g_lon5;
        }
        return out;
      }
      return {
        matched: false,
        key,
        name: x?.name || '',
        lat: lat5,
        lon: lon5,
        city: x?.city || null,
      };
    });

    res.set('X-Match-Hit', String(results.filter(r => r.matched).length));
    res.set('X-Match-Miss', String(results.filter(r => !r.matched).length));
    return res.json({ results });
  } catch (e) {
    console.error('[poiMatch:POST] error:', e?.message || e);
    return res.status(500).json({ error: 'match_failed' });
  }
});

// PUT /api/poi/match  → batch upsert
router.put('/match', express.json({ limit: '512kb' }), (req, res) => {
  try {
    const list = Array.isArray(req.body?.matches) ? req.body.matches : [];
    const rows = list
      .filter(m =>
        m && m.place_id &&
        m.name != null &&
        Number.isFinite(Number(m.lat)) &&
        Number.isFinite(Number(m.lon))
      )
      .map(m => toRow({
        name: m.name,
        lat: m.lat,
        lon: m.lon,
        city: m.city || null,
        place_id: m.place_id,
        rating: m.rating ?? null,
        hours: m.hours ?? null,
        g_lat: m.g_lat,
        g_lon: m.g_lon,
        item_id: m.item_id || m.osm_id || null, // ⬅️ benzersiz seed id
      }));

    const n = rows.length ? upsertMany(rows) : 0;
    return res.json({ upserted: n });
  } catch (e) {
    console.error('[poiMatch:PUT] error:', e?.message || e);
    return res.status(500).json({ error: 'upsert_failed' });
  }
});

module.exports = router;
