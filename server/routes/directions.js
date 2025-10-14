// server/routes/directions.js
const express = require('express');
const router = express.Router();
const { getRoute } = require('../services/googleMaps');

router.get('/', async (req, res) => {
  const { from, to, mode = 'driving' } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

  try {
    const data = await getRoute(from, to, mode);
    // data polyline veriyorsa aynen bas:
    if (Array.isArray(data?.polyline)) return res.json(data);

    // Google raw ise:
    const enc = data?.routes?.[0]?.overview_polyline?.points;
    if (enc) return res.json({ polyline: [{ encoded: enc }] }); // (istersen encoded da dönebilirsin)
    return res.json({ polyline: data?.polyline || [] });
  } catch (err) {
    res.status(500).json({ error: 'Route fetch failed', details: err.message });
  }
});

module.exports = router;
