// server/index.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');

dotenv.config();
connectDB();

const app = express();

app.use(cors());
app.use(express.json());

// health
app.get('/health', (req, res) => res.json({ ok: true }));

// routes
app.use('/api/route', require('./routes/directions'));
//app.use('/api/trips', require('./routes/trips'));
app.use('/api/poi', require('./routes/poi'));

app.use((req,res,next)=>{
  if (req.path.startsWith('/api/poi/google/')) {
    console.log(`[HIT] ${req.method} ${req.path} q=${req.query?.q || ''} city=${req.query?.city || ''}`);
  }
  next();
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Sunucu ${PORT} portunda çalışıyor`);
});
