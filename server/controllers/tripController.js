const Trip = require('../models/Trip');

// Trip oluştur
const createTrip = async (req, res) => {
  try {
    const trip = new Trip(req.body);
    await trip.save();
    res.status(201).json(trip);
  } catch (err) {
    res.status(500).json({ error: 'Trip creation failed', details: err.message });
  }
};

// Tüm trip'leri getir
const getAllTrips = async (req, res) => {
  try {
    const trips = await Trip.find().sort({ createdAt: -1 });
    res.json(trips);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trips', details: err.message });
  }
};

// Belirli trip'i getir
const getTripById = async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch trip', details: err.message });
  }
};

module.exports = {
  createTrip,
  getAllTrips,
  getTripById,
};