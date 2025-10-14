// server/index.js
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

// Routers
const suggestRouter = require('./routes/suggest');
const poiGoogleRoutes = require('./routes/poi_google');
const poiRouter = require('./routes/poi');
const poiMatchRouter = require('./routes/poiMatch');
const directionsRouter = require('./routes/directions');

// 1) .env: server klasöründeki dosyayı açıkça yükle
const envPath = path.join(__dirname, '.env');
const loaded = dotenv.config({ path: envPath });
if (loaded.error) {
  console.warn('[ENV] .env yüklenemedi:', loaded.error.message);
} else {
  console.log('[ENV] yüklendi:', envPath);
  // hızlı teşhis: GOOGLE* değişkenlerini göster
  const keys = Object.keys(process.env).filter(k => k.toUpperCase().includes('GOOGLE'));
  console.log('[ENV] GOOGLE keys:', keys);
}

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// Baseline health
app.get('/health', (req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

// Basit istek logu (ROUTE'lerden önce)
app.use((req, res, next) => {
  if (
    req.path.startsWith('/api/poi/google/') ||
    req.path.startsWith('/api/directions') ||
    req.path.startsWith('/api/route')
  ) {
    const q = (req.query?.q || '').toString();
    const city = (req.query?.city || '').toString();
    console.log(`[HIT] ${req.method} ${req.path} q="${q}" city="${city}" t=${new Date().toISOString()}`);
  }
  next();
});

// Global (yumuşak) timeout
const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS || 15000);
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    req.setTimeout?.(REQ_TIMEOUT_MS);
    res.setHeader('X-Req-Timeout', String(REQ_TIMEOUT_MS));
  }
  next();
});

/* ================== ROUTES (tek kez!) ================== */

// Directions: İKİ path altında da aynı router
app.use('/api/directions', directionsRouter);
app.use('/api/route', directionsRouter);

// POI ana uçları
app.use('/api/poi', poiRouter);
app.use('/api/poi', poiMatchRouter);
app.use('/api/poi', suggestRouter);

// Google proxy (router kendi base path’ini içeriyorsa çıplak mount)
app.use(poiGoogleRoutes);

/* ================== 404 & ERROR ================== */

app.use((req, res, next) => {
  if (req.path === '/' || req.path === '') return res.status(200).send('OK');
  res.status(404).json({ error: 'not_found', path: req.path });
});

app.use((err, req, res, next) => {
  console.error('[ERR]', err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
});

/* ================== LISTEN ================== */

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`🚀 Sunucu ${HOST}:${PORT} üzerinde çalışıyor`);
});
