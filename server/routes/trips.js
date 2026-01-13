// server/routes/trips.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const tripController = require('../controllers/tripController');

// x-device-id → req.userId = device:<id>
function deviceUser(req, _res, next) {
  const d = (req.header('x-device-id') || '').trim();
  if (d) req.userId = `device:${d}`;
  next();
}

// DB yoksa 503
function requireDb(req, res, next) {
  const ok = mongoose.connection?.readyState === 1; // 1 = connected
  if (!ok) return res.status(503).json({ error: 'db_unavailable' });
  next();
}

router.use(deviceUser);

// ✅ sync (MUST be before "/:id")
router.post('/sync', requireDb, tripController.syncTrips);

// list
router.get('/', requireDb, tripController.getAllTrips);

// create
router.post('/', requireDb, tripController.createTrip);

// get by id
router.get('/:id', requireDb, tripController.getTripById);

// update (patch)
router.patch('/:id', requireDb, tripController.updateTrip);

// soft delete
router.delete('/:id', requireDb, tripController.softDeleteTrip);

module.exports = router;
