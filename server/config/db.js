// server/config/db.js
const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
  if (!uri) {
    console.warn('[DB] MONGODB_URI tanımlı değil — bağlantı atlandı (dev/test).');
    return null;
  }
  try {
    await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME || undefined });
    console.log('✅ MongoDB bağlandı');
    return mongoose;
  } catch (e) {
    console.error('❌ MongoDB bağlantı hatası:', e?.message || e);
    // dev’de API’leri bloklamayalım:
    return null;
  }
}

module.exports = connectDB;
