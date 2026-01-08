// server/index.js
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const compression = require('compression');

/* ==================================================
   1) .env mutlaka EN BAŞTA yüklenmeli
   ================================================== */

const envPath = path.join(__dirname, '.env');
const loaded = dotenv.config({ path: envPath });
const PLACES_KEY =
  process.env.GOOGLE_PLACES_KEY ||
  process.env.PLACES_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  '';
const masked = PLACES_KEY.slice(0, 6) + '...' + PLACES_KEY.slice(-4);

if (loaded.error) {
  console.warn('[ENV] .env yüklenemedi:', loaded.error.message);
} else {
  console.log('[ENV] yüklendi:', envPath);
  console.log('[ENV] GOOGLE_MAPS_API_KEY =', masked);
  console.log('[ENV] GOOGLE_PLACES_KEY =', masked);
  console.log('[ENV] PLACES_API_KEY =', masked);
}

/* ==================================================
   2) .env yüklendikten SONRA tüm router/modüller require edilecek
   ================================================== */

// Routers (dotenv sonrasında!)
const suggestRouter = require('./routes/suggest');
const poiGoogleRoutes = require('./routes/poi_google');
const poiRouter = require('./routes/poi');
const poiMatchRouter = require('./routes/poiMatch');
const directionsRouter = require('./routes/directions');

/* ==================================================
   3) Express app
   ================================================== */

const app = express();
app.set('trust proxy', 1);

app.use(cors());
app.use(compression());

const BODY_LIMIT = process.env.BODY_LIMIT || '25mb';
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// Büyük body uyarıcı
app.use((req, _res, next) => {
  const len = req.headers['content-length'];
  if (len && Number(len) > 200 * 1024) {
    console.warn('[BIG]', req.method, req.url, 'size=', len);
  }
  next();
});

// Basit health check
app.get('/health', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));

// API logger
app.use((req, _res, next) => {
  if (
    req.path.startsWith('/api/poi/google/') ||
    req.path.startsWith('/api/directions') ||
    req.path.startsWith('/api/route')
  ) {
    const q = (req.query?.q || '').toString();
    const city = (req.query?.city || '').toString();
    if (q || req.path !== '/api/directions') {
      console.log(
        `[HIT] ${req.method} ${req.path} q="${q}" city="${city}" t=${new Date().toISOString()}`
      );
    }
  }
  next();
});

// Timeout
const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS || 15000);
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    req.setTimeout?.(REQ_TIMEOUT_MS);
    res.setHeader('X-Req-Timeout', String(REQ_TIMEOUT_MS));
  }
  next();
});

/* ==================================================
   ROUTES
   ================================================== */

// Directions iki path'te
app.use('/api/directions', directionsRouter);
app.use('/api/route', directionsRouter);

// POI ana
app.use('/api/poi', poiRouter);
app.use('/api/poi', poiMatchRouter);
app.use('/api/poi', suggestRouter);

// Google proxy
app.use(poiGoogleRoutes);

// 404
app.use((req, res) => {
  if (req.path === '/' || req.path === '') return res.status(200).send('OK');
  res.status(404).json({ error: 'not_found', path: req.path });
});

// 413 handler
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    console.error('[413] payload too large', req.method, req.url, 'size=', req.headers['content-length']);
    if (!res.headersSent) {
      return res.status(413).json({ ok: false, error: 'Payload too large', max: BODY_LIMIT });
    }
  }
  next(err);
});

// Genel hata
app.use((err, _req, res) => {
  console.error('[ERR]', err?.stack || err?.message || err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'internal_error', message: err?.message || String(err) });
  }
});

/* ==================================================
   LISTEN
   ================================================== */

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '192.168.1.102';

app.listen(PORT, HOST, () => {
  console.log(`🚀 Sunucu ${HOST}:${PORT} üzerinde çalışıyor`);
});
