const express = require('express');
const router = express.Router();
const { getRoute } = require('../services/googleMaps');

router.get('/', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });

  try {
    const data = await getRoute(from, to);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Route fetch failed', details: err.message });
  }
});

module.exports = router;
