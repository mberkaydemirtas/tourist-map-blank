// server/routes/suggest.js
console.log('[SUGGEST ROUTER LOADED]', __filename);

const express = require('express');
const router = express.Router();
const path = require('path');
const Database = require('better-sqlite3');

// === DB ===
const DB_PATH = path.join(__dirname, '..', 'data', 'poi_suggest.db');
let db;
function getDb() {
  if (!db) db = new Database(DB_PATH, { fileMustExist: true, timeout: 3000 });
  return db;
}
console.log('[SUGGEST] DB_PATH=', DB_PATH);

// === TR fold / normalize ===
function trFold(s = '') {
  const map = { 'İ':'I','I':'I','ı':'i','Ş':'S','ş':'s','Ğ':'G','ğ':'g','Ü':'U','ü':'u','Ö':'O','ö':'o','Ç':'C','ç':'c' };
  const str = String(s || '');
  try {
    return str
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch => map[ch] || ch)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return str
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch => map[ch] || ch)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}

function tokenizeNorm(s = '') {
  return trFold(s).split(' ').filter(Boolean);
}

function safeParseJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function pickFields(r) {
  return {
    place_id: r.place_id,
    name: r.name,
    address: r.address,
    city: r.city,
    lat: r.lat,
    lon: r.lon,
    rating: r.rating,
    user_ratings_total: r.user_ratings_total,
    price_level: r.price_level,
    types: Array.isArray(r.types_json) ? r.types_json : safeParseJSON(r.types_json || '[]', []),
    source: r.source || 'google',
    origin: 'suggest',
  };
}

// dynamic tokenized SQL: supports contains + last-token prefix
function buildTokenSql({ tokens, withCity, prefixOnLast = true }) {
  const conds = [];
  const params = {};

  tokens.forEach((tk, i) => {
    const keyC = `t${i}c`;
    const keyP = `t${i}p`;
    if (prefixOnLast && i === tokens.length - 1) {
      conds.push(`(
        (name_norm LIKE @${keyC} OR LOWER(name) LIKE @${keyC})
        OR (name_norm LIKE @${keyP} OR LOWER(name) LIKE @${keyP})
      )`);
      params[keyC] = `%${tk}%`;
      params[keyP] = `${tk}%`;
    } else {
      conds.push(`(name_norm LIKE @${keyC} OR LOWER(name) LIKE @${keyC})`);
      params[keyC] = `%${tk}%`;
    }
  });

  let sql = `
    SELECT
      place_id, name, name_norm, address, city,
      lat5 AS lat, lon5 AS lon,
      rating, user_ratings_total, price_level,
      types AS types_json,
      source, provider, hits
    FROM poi_suggest
    WHERE ${conds.join(' AND ')}
  `;

  if (withCity) {
    sql += ` AND (
      city = @cityRaw
      OR city_norm = @cityNorm
      OR IFNULL(city,'') = ''
    ) `;
  }

  sql += ` ORDER BY hits DESC, user_ratings_total DESC, rating DESC, name ASC LIMIT @limit `;
  return { sql, params };
}

/* ========================= HANDLERS ========================= */

function handleSuggest(req, res) {
  const qRaw = String(req.query.q || '').trim();
  const cityRaw = String(req.query.city || '').trim();
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 12));

  if (!qRaw || qRaw.length < 2) {
    return res.json({ results: [] });
  }

  const qNorm = trFold(qRaw);
  const tokens = tokenizeNorm(qRaw);
  const db = getDb();

  const cityNorm = trFold(cityRaw);

  const out = [];
  const seen = new Set();
  let stageUsed = 0;

  try {
    // Stage 1: city + prefix
    if (out.length < limit) {
      const rows = (cityRaw || cityNorm)
        ? db.prepare(`
            SELECT
              place_id, name, name_norm, address, city,
              lat5 AS lat, lon5 AS lon,
              rating, user_ratings_total, price_level,
              types AS types_json,
              source, provider, hits
            FROM poi_suggest
            WHERE (
              city = @cityRaw
              OR city_norm = @cityNorm
              OR IFNULL(city,'') = ''
            )
            AND (name_norm LIKE @pref OR LOWER(name) LIKE @pref)
            ORDER BY hits DESC, user_ratings_total DESC, rating DESC, name ASC
            LIMIT @limit
          `).all({ cityRaw, cityNorm, pref: `${qNorm}%`, limit })
        : db.prepare(`
            SELECT
              place_id, name, name_norm, address, city,
              lat5 AS lat, lon5 AS lon,
              rating, user_ratings_total, price_level,
              types AS types_json,
              source, provider, hits
            FROM poi_suggest
            WHERE (name_norm LIKE @pref OR LOWER(name) LIKE @pref)
            ORDER BY hits DESC, user_ratings_total DESC, rating DESC, name ASC
            LIMIT @limit
          `).all({ pref: `${qNorm}%`, limit });

      for (const r of rows) {
        if (seen.has(r.place_id)) continue;
        seen.add(r.place_id);
        out.push(pickFields(r));
        if (out.length >= limit) break;
      }
      if (rows.length) stageUsed = 1;
    }

    // Stage 2: city + token contains + last token prefix
    if (out.length < limit && tokens.length) {
      const { sql, params } = buildTokenSql({ tokens, withCity: !!(cityRaw || cityNorm), prefixOnLast: true });
      const rows = db.prepare(sql).all({ ...params, cityRaw, cityNorm, limit });

      for (const r of rows) {
        if (seen.has(r.place_id)) continue;
        seen.add(r.place_id);
        out.push(pickFields(r));
        if (out.length >= limit) break;
      }
      if (rows.length && stageUsed === 0) stageUsed = 2;
    }

    // Stage 3: global token contains + last token prefix (no city)
    if (out.length < limit && tokens.length && (cityRaw || cityNorm)) {
      const { sql, params } = buildTokenSql({ tokens, withCity: false, prefixOnLast: true });
      const rows = db.prepare(sql).all({ ...params, limit });

      for (const r of rows) {
        if (seen.has(r.place_id)) continue;
        seen.add(r.place_id);
        out.push(pickFields(r));
        if (out.length >= limit) break;
      }
      if (rows.length && stageUsed === 0) stageUsed = 3;
    }

    // Stage 4: fallback contains (no city)
    if (out.length < limit) {
      const rows = db.prepare(`
        SELECT
          place_id, name, name_norm, address, city,
          lat5 AS lat, lon5 AS lon,
          rating, user_ratings_total, price_level,
          types AS types_json,
          source, provider, hits
        FROM poi_suggest
        WHERE (name_norm LIKE @any OR LOWER(name) LIKE @any)
        ORDER BY hits DESC, user_ratings_total DESC, rating DESC, name ASC
        LIMIT @limit
      `).all({ any: `%${qNorm}%`, limit });

      for (const r of rows) {
        if (seen.has(r.place_id)) continue;
        seen.add(r.place_id);
        out.push(pickFields(r));
        if (out.length >= limit) break;
      }
      if (rows.length && stageUsed === 0) stageUsed = 4;
    }

    console.log('[SUGGEST] q="%s" qNorm="%s" city="%s" cityNorm="%s" tokens=%j → out=%d stage=%d',
      qRaw, qNorm, cityRaw, cityNorm, tokens, out.length, stageUsed);

    res.set('X-Source', 'suggest-db');
    res.set('X-Stage', String(stageUsed || 0));
    return res.json({ results: out });
  } catch (e) {
    console.error('[poiSuggest] error:', e);
    return res.status(200).json({ results: [], ok: false, error: e?.message || String(e) });
  }
}

function handleStats(req, res) {
  try {
    const cityRaw = String(req.query.city || '').trim();
    const cityNorm = trFold(cityRaw);
    const db = getDb();

    const total = db.prepare(`SELECT COUNT(*) AS n FROM poi_suggest`).get()?.n || 0;

    const byCity = db.prepare(`
      SELECT COUNT(*) AS n
      FROM poi_suggest
      WHERE (
        (@cityRaw = '' AND @cityNorm = '')
        OR city = @cityRaw
        OR city_norm = @cityNorm
      )
    `).get({ cityRaw, cityNorm })?.n || 0;

    const topCities = db.prepare(`
      SELECT COALESCE(city,'') AS city, COUNT(*) AS n
      FROM poi_suggest
      GROUP BY COALESCE(city,'')
      ORDER BY n DESC
      LIMIT 10
    `).all();

    return res.json({ ok: true, total, city: cityRaw || '', cityNorm: cityNorm || '', byCity, topCities });
  } catch (e) {
    console.error('[suggest/stats] error', e);
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}

/* ========================= ROUTES =========================
   Bu router iki farklı mount biçimini de destekler:

   A) app.use('/api/poi', suggestRouter)
      -> GET /api/poi/suggest
      -> GET /api/poi/suggest/stats

   B) app.use('/api/poi/suggest', suggestRouter)
      -> GET /api/poi/suggest
      -> GET /api/poi/suggest/stats
*/

// “root” (B senaryosu)
router.get('/', handleSuggest);
router.get('/stats', handleStats);

// “/suggest” (A senaryosu)
router.get('/suggest', handleSuggest);
router.get('/suggest/stats', handleStats);

module.exports = router;
