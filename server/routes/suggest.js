// server/routes/suggest.js
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
      conds.push(`((name_norm LIKE @${keyC} OR LOWER(name) LIKE @${keyC}) OR (name_norm LIKE @${keyP} OR LOWER(name) LIKE @${keyP}))`);
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
    // city eşleşmeyen ama city boş olanları da al
    sql += ` AND (city = @city OR IFNULL(city,'') = '') `;
  }

  sql += ` ORDER BY hits DESC, user_ratings_total DESC, rating DESC, name ASC LIMIT @limit `;
  return { sql, params };
}

router.get('/suggest', (req, res) => {
  const qRaw = String(req.query.q || '').trim();
  const cityRaw = String(req.query.city || '').trim();
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 12));

  if (!qRaw || qRaw.length < 2) {
    return res.json({ results: [] });
  }

  const qNorm = trFold(qRaw);
  const city = cityRaw;
  const tokens = tokenizeNorm(qRaw);
  const db = getDb();

  const out = [];
  const seen = new Set();
  let stageUsed = 0;

  try {
    // Stage 1: city + pure prefix
    if (out.length < limit) {
      const rows = city
        ? db.prepare(`
            SELECT
              place_id, name, name_norm, address, city,
              lat5 AS lat, lon5 AS lon,
              rating, user_ratings_total, price_level,
              types AS types_json,
              source, provider, hits
            FROM poi_suggest
            WHERE (city = @city OR IFNULL(city,'') = '')
              AND (name_norm LIKE @pref OR LOWER(name) LIKE @pref)
            ORDER BY hits DESC, user_ratings_total DESC, rating DESC, name ASC
            LIMIT @limit
          `).all({ city, pref: `${qNorm}%`, limit })
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
      const { sql, params } = buildTokenSql({ tokens, withCity: !!city, prefixOnLast: true });
      const rows = db.prepare(sql).all({ ...params, city, limit });

      for (const r of rows) {
        if (seen.has(r.place_id)) continue;
        seen.add(r.place_id);
        out.push(pickFields(r));
        if (out.length >= limit) break;
      }
      if (rows.length && stageUsed === 0) stageUsed = 2;
    }

    // Stage 3: global token contains + last token prefix (no city)
    if (out.length < limit && tokens.length && city) {
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

    console.log('[SUGGEST] q="%s" qNorm="%s" city="%s" tokens=%j → out=%d stage=%d',
      qRaw, qNorm, city, tokens, out.length, stageUsed);

    res.set('X-Source', 'suggest-db');
    res.set('X-Stage', String(stageUsed || 0));
    return res.json({ results: out });
  } catch (e) {
    console.error('[poiSuggest] error:', e);
    return res.status(500).json({ error: 'suggest_failed' });
  }
});

module.exports = router;
