// server/routes/suggest.js
const express = require('express');
const router = express.Router();
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'poi_suggest.db');
let db;
function getDb() {
  if (!db) db = new Database(DB_PATH, { fileMustExist: true, timeout: 3000 });
  return db;
}

// TR fold (client ile birebir)
function trFold(s = '') {
  const map = { 'İ':'I','I':'I','ı':'i','Ş':'S','ş':'s','Ğ':'G','ğ':'g','Ü':'U','ü':'u','Ö':'O','ö':'O','Ç':'C','ç':'C' };
  const str = String(s||'');
  try {
    return str.normalize('NFKD')
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
    types: (() => { try { return JSON.parse(r.types_json || '[]'); } catch { return []; } })(),
    source: 'google',   // cache olsa bile overlay davranışı için "google"
    origin: 'suggest',
  };
}

// Dinamik token-bazlı koşullar: ORNEK
// tokens=['anitk','muz'] → (contains 'anitk') AND (contains 'muz' OR prefix 'muz%')
// stage 2/3'te 'prefix' çoğunlukla SON token için uygulanır.
function buildTokenSql({ tokens, withCity, prefixOnLast = true }) {
  const conds = [];
  const params = {};

  tokens.forEach((tk, i) => {
    const keyC = `t${i}c`;
    const keyP = `t${i}p`;
    if (prefixOnLast && i === tokens.length - 1) {
      // contains OR prefix
      conds.push(`(name_norm LIKE @${keyC} OR name_norm LIKE @${keyP})`);
      params[keyC] = `%${tk}%`;
      params[keyP] = `${tk}%`;
    } else {
      // contains only
      conds.push(`(name_norm LIKE @${keyC})`);
      params[keyC] = `%${tk}%`;
    }
  });

  let sql = `
    SELECT place_id, name, name_norm, address, city, lat, lon,
           rating, user_ratings_total, price_level, types_json
    FROM poi_suggest
    WHERE ${conds.join(' AND ')}
  `;

  if (withCity) {
    sql += ` AND city = @city `;
  }

  sql += ` ORDER BY user_ratings_total DESC, rating DESC LIMIT @limit `;

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
  const city = cityRaw; // city normalize etmeye gerek yok; eşitlik kontrolü
  const tokens = tokenizeNorm(qRaw);
  const db = getDb();

  const out = [];
  const seen = new Set();
  let stageUsed = 0;

  try {
    // === Stage 1: city + pure prefix ===
    // Örn: qNorm='anitk' → name_norm LIKE 'anitk%'
    if (out.length < limit) {
      const rows = city
        ? db.prepare(`
            SELECT place_id, name, name_norm, address, city, lat, lon,
                   rating, user_ratings_total, price_level, types_json
            FROM poi_suggest
            WHERE city = @city
              AND name_norm LIKE @pref
            ORDER BY user_ratings_total DESC, rating DESC
            LIMIT @limit
          `).all({ city, pref: `${qNorm}%`, limit })
        : db.prepare(`
            SELECT place_id, name, name_norm, address, city, lat, lon,
                   rating, user_ratings_total, price_level, types_json
            FROM poi_suggest
            WHERE name_norm LIKE @pref
            ORDER BY user_ratings_total DESC, rating DESC
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

    // === Stage 2: city + token contains + last token prefix ===
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

    // === Stage 3: global token contains + last token prefix (no city) ===
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

    // === Stage 4: fallback contains (no city) ===
    if (out.length < limit) {
      const rows = db.prepare(`
        SELECT place_id, name, name_norm, address, city, lat, lon,
               rating, user_ratings_total, price_level, types_json
        FROM poi_suggest
        WHERE name_norm LIKE @any
        ORDER BY user_ratings_total DESC, rating DESC
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

    console.log('[SUGGEST] q="%s" → qNorm="%s" city="%s" tokens=%j → out=%d stage=%d',
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
