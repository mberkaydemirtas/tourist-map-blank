// server/routes/poi_cache.js
const express = require('express');
const router = express.Router();

const { searchCache } = require('../lib/poiCacheDB');

router.get('/api/poi/cache/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const city = String(req.query.city || '').trim();
  const country = String(req.query.country || '').trim();
  const category = String(req.query.category || '').trim();
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 12));

  if (!q || q.length < 2) return res.json({ results: [] });

  try {
    const results = await searchCache({ q, city: city || undefined, country: country || undefined, limit, category: category || undefined });
    return res.json({ results });
  } catch (e) {
    console.warn('[CACHE/search] error:', e?.message || e);
    return res.status(500).json({ error: 'cache_search_failed' });
  }
});

module.exports = router;
