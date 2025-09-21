// index.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');

dotenv.config();
connectDB();

const app = express();

app.use(cors());
app.use(express.json());

// Basit health-check
app.get('/health', (req, res) => res.json({ ok: true }));

// Routes
app.use('/api/route', require('./routes/directions'));
app.use('/api/trips', require('./routes/trips'));
app.use('/api/poi', require('./routes/poi'));   // ✅ Yeni eklenen POI route

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Sunucu ${PORT} portunda çalışıyor`);
});
