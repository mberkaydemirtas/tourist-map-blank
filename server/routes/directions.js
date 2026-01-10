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
<<<<<<< Updated upstream
    const { from, to, mode = 'driving' } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to required' });
    }

    if (!GOOGLE_KEY) {
      return res.status(500).json({ error: 'NO_GOOGLE_KEY' });
    }

    // from = "lat,lng"
    // to   = "lat,lng"
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', from);
    url.searchParams.set('destination', to);
    url.searchParams.set('mode', mode);
    url.searchParams.set('key', GOOGLE_KEY);
    url.searchParams.set('departure_time', 'now');

    const r = await fetch(url.toString());
    const json = await r.json();

    if (json.status !== 'OK') {
      return res.status(502).json({
        error: 'GOOGLE_DIRECTIONS_FAILED',
        details: json.error_message || json.status,
      });
    }

    const route = json.routes[0];
    const encoded = route.overview_polyline.points;
    const decoded = polyline.decode(encoded).map(p => ({
      latitude: p[0],
      longitude: p[1],
    }));

    return res.json({
      polyline: decoded,
      encoded,
      legs: route.legs,
      summary: {
        distanceVal: route.legs.reduce((a, l) => a + l.distance.value, 0),
        durationVal: route.legs.reduce((a, l) => a + l.duration.value, 0),
      },
    });
  } catch (err) {
    console.error('[DIR] Error:', err);
    return res.status(500).json({
      error: 'ROUTE_FETCH_FAILED',
      details: err.message,
=======
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
>>>>>>> Stashed changes
    });
  }
});

module.exports = router;
