const mongoose = require('mongoose');

const TripSchema = new mongoose.Schema({
  title: { type: String, required: true },
  places: [
    {
      place_id: String,
      name: String,
      coords: {
        lat: Number,
        lng: Number,
      },
      addedAt: Date,
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Trip', TripSchema);
