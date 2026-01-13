const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const polyline = require('@mapbox/polyline');

const GOOGLE_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_PLACES_KEY ||
  process.env.PLACES_API_KEY;

/**
 * GET /api/directions
 *
 * Beklenen: ?from=lat,lng&to=lat,lng&mode=driving|walking|transit
 * Yanlışlıkla ?q=... ile çağrılırsa gürültü yapmadan boş yanıt döner.
 */
router.get('/', async (req, res) => {
  try {
    // “q” parametresi ile gelen boş istekleri zarifçe yut (UI debounce/guard için ek güvenlik)
    if (typeof req.query.q !== 'undefined') {
      const q = String(req.query.q || '').trim();
      if (!q) return res.json({ ok: true, items: [] });
      // ileride directions araması yapmayı düşünürsen burada işleyebilirsin
      return res.json({ ok: true, items: [] });
    }

    const { from, to, mode = 'driving' } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to are required' });
    }

    const data = await getRoute(from, to, mode);
    // data.polyline {encoded} formatında
    return res.json({ polyline: data.polyline });
  } catch (err) {
    console.warn('[directions] error:', err?.message);
    return res.status(500).json({
      error: 'Route fetch failed',
      details: err?.message || String(err),
    });
  }
});

module.exports = router;
