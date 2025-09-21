const express = require('express');
const router = express.Router();
const {
  createTrip,
  getAllTrips,
  getTripById,
} = require('../controllers/tripController');

router.post('/', createTrip);         // POST /api/trips
router.get('/', getAllTrips);         // GET /api/trips
router.get('/:id', getTripById);      // GET /api/trips/123abc

module.exports = router;
