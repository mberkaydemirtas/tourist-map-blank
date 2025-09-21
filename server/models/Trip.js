const mongoose = require('mongoose');

/**
 * Not: Mevcut yapındaki "title" ve "places[*].coords" alanlarını KORUDUM.
 * Üzerine senkronizasyon ve seyahat planı alanlarını (cities, dateRange, start/end, lodgings, version, userId, deleted) ekledim.
 */

const PointSchema = new mongoose.Schema({
  id: String,
  name: String,
  // coords (senin mevcut yapınla uyumlu)
  coords: {
    lat: Number,
    lng: Number,
  },
  // alternatif düz alanlar (ileride ihtiyaç olursa)
  lat: Number,
  lon: Number,

  source: String,      // 'google' | 'osm'
  place_id: String,
  osm_id: String,
  addedAt: Date,
}, { _id: false });

const LodgingSchema = new mongoose.Schema({
  id: String,
  name: String,
  checkIn: String,     // yyyy-mm-dd
  checkOut: String,    // yyyy-mm-dd
  coords: {
    lat: Number,
    lng: Number,
  },
  lat: Number,
  lon: Number,
  source: String,
  place_id: String,
  osm_id: String,
}, { _id: false });

const TripSchema = new mongoose.Schema({
  // === Senin alanların ===
  title: { type: String, required: true },
  places: [PointSchema],
  createdAt: { type: Date, default: Date.now },

  // === Senkronizasyon / kimlik ===
  _id: { type: String, required: false },         // uuid-v4 (client üretirse kullanılır)
  userId: { type: String, index: true },          // 'device:<id>' veya auth uid
  version: { type: Number, default: 1 },          // optimistic locking
  updatedAt: { type: Date, default: () => new Date() },
  deleted: { type: Boolean, default: false },

  // === Trip plan alanları ===
  cities: [String],
  dateRange: {
    start: String,  // yyyy-mm-dd
    end:   String,
  },
  start: PointSchema,
  end:   PointSchema,
  lodgings: [LodgingSchema],
}, { minimize: true });

// indeksler (isteğe bağlı optimizasyon)
TripSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model('Trip', TripSchema);
