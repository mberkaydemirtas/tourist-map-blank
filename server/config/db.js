// server/config/db.js
const mongoose = require('mongoose');

let listenersAttached = false;

async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
  const dbName = process.env.MONGO_DB_NAME || undefined;

  // ✅ Buffering kapalı: DB yoksa requestler asılı kalmasın
  mongoose.set('bufferCommands', false);

  // ✅ Debug için event logları (1 kere bağla)
  if (!listenersAttached) {
    listenersAttached = true;

    mongoose.connection.on('connected', () => {
      console.log('[DB] connected. readyState=', mongoose.connection.readyState);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[DB] disconnected. readyState=', mongoose.connection.readyState);
    });

    mongoose.connection.on('error', (err) => {
      console.error('[DB] error:', err?.message || err);
    });

    mongoose.connection.on('reconnected', () => {
      console.log('[DB] reconnected. readyState=', mongoose.connection.readyState);
    });
  }

  if (!uri) {
    console.warn('[DB] MONGODB_URI tanımlı değil — DB bağlantısı YOK. Trips API 503 döndürmeli.');
    return null;
  }

  try {
    await mongoose.connect(uri, {
      dbName,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });

    console.log('✅ MongoDB bağlandı');
    return mongoose;
  } catch (e) {
    console.error('❌ MongoDB bağlantı hatası:', e?.message || e);
    return null;
  }
}

module.exports = connectDB;
