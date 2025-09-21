const express = require('express');
const router = express.Router();
const {
  createTrip,
  getAllTrips,
  getTripById,
  updateTrip,
  softDeleteTrip,
  syncTrips,
} = require('../controllers/tripController');

// Geçici kimlik (auth gelene kadar). İstersen zorunlu yapmayabilirsin.
function requireDevice(req, res, next) {
  const dev = req.header('x-device-id');
  if (!dev) {
    // İzinli: device yoksa anonim kullanıcı gibi davran
    req.userId = null;
    return next();
  }
  req.userId = `device:${dev}`;
  next();
}

router.use(requireDevice);

// CRUD
router.post('/', createTrip);               // POST /api/trips
router.get('/', getAllTrips);               // GET  /api/trips?since=ISO
router.get('/:id', getTripById);            // GET  /api/trips/:id
router.put('/:id', updateTrip);             // PUT  /api/trips/:id + If-Match-Version
router.delete('/:id', softDeleteTrip);      // DELETE /api/trips/:id (soft)

// Delta Sync
router.post('/sync', syncTrips);            // POST /api/trips/sync

module.exports = router;
