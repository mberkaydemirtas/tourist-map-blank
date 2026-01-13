// server/models/Trip.js
const mongoose = require('mongoose');

/**
 * Amaç:
 * - Client bazen {id:"..."} ile geliyor → biz Mongo'da bunu _id olarak tutacağız (string).
 * - App tarafı "selectedPlaces" kullanıyor → şemaya ekliyoruz.
 * - Response'ta hem _id hem id olsun (client rahat etsin).
 * - deletedAt eklendi: client (deletedAt) & server (deleted) uyumu + delta sync için.
 */

const CoordsSchema = new mongoose.Schema(
  {
    lat: Number,
    lng: Number,
  },
  { _id: false }
);

const PointSchema = new mongoose.Schema(
  {
    id: String,
    name: String,

    // mevcut yapınla uyumlu
    coords: CoordsSchema,

    // alternatif düz alanlar
    lat: Number,
    lon: Number, // not: bazen "lon" geliyor (lng değil)

    source: String, // 'google' | 'osm' | 'manual'
    place_id: String,
    osm_id: String,
    types: [String],
    address: String,

    addedAt: Date,
  },
  { _id: false }
);

const LodgingSchema = new mongoose.Schema(
  {
    id: String,
    name: String,
    checkIn: String, // yyyy-mm-dd
    checkOut: String, // yyyy-mm-dd

    coords: CoordsSchema,
    lat: Number,
    lon: Number,

    source: String,
    place_id: String,
    osm_id: String,

    address: String,
  },
  { _id: false }
);

const TripSchema = new mongoose.Schema(
  {
    // ✅ _id her zaman STRING olsun:
    _id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(),
    },

    userId: { type: String, index: true }, // device:<id> veya auth uid
    version: { type: Number, default: 1 },

    // ✅ Delta sync için Date
    updatedAt: { type: Date, default: () => new Date() },

    // ✅ Soft delete flags
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null }, // ✅ eklendi

    // Senin alanların
    title: { type: String, default: '' },
    places: { type: [PointSchema], default: [] },
    createdAt: { type: Date, default: Date.now },

    // ✅ App'in şu an kullandığı alan
    selectedPlaces: { type: [PointSchema], default: [] },

    // Plan alanları
    cities: { type: [String], default: [] },
    dateRange: {
      start: String,
      end: String,
    },
    start: PointSchema,
    end: PointSchema,
    lodgings: { type: [LodgingSchema], default: [] },
  },
  {
    minimize: true,
    strict: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        if (!ret.id && ret._id) ret.id = ret._id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform(_doc, ret) {
        if (!ret.id && ret._id) ret.id = ret._id;
        return ret;
      },
    },
  }
);

TripSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model('Trip', TripSchema);
