// tools/check-suggest.js
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'poi_suggest.db');
const db = new Database(DB_PATH, { fileMustExist: true });

console.log('rows in poi_suggest =', db.prepare('SELECT COUNT(*) AS n FROM poi_suggest').get());

console.log('sample 3 rows =');
console.log(db.prepare(`
  SELECT place_id, name, city, name_norm,
         lat5 AS lat, lon5 AS lon, rating, user_ratings_total
  FROM poi_suggest
  ORDER BY user_ratings_total DESC, rating DESC
  LIMIT 3
`).all());

// “anit”, “kafe”, vs. gibi bir örnek arama:
const q = 'kafe'.toLowerCase();
console.log('LIKE test (name_norm) =',
  db.prepare(`SELECT COUNT(*) AS n FROM poi_suggest WHERE name_norm LIKE ?`).get(`%${q}%`)
);
console.log('LIKE test (name) =',
  db.prepare(`SELECT COUNT(*) AS n FROM poi_suggest WHERE LOWER(name) LIKE ?`).get(`%${q}%`)
);
