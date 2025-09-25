// app/db/schema.sql
CREATE TABLE IF NOT EXISTS poi (
  id TEXT PRIMARY KEY,
  country TEXT,         -- "TR"
  city TEXT,            -- "Ankara"
  category TEXT,        -- "restaurants" | "cafes" | ...
  name TEXT,
  nameNorm TEXT,        -- önceden normalize
  lat REAL,
  lon REAL,
  address TEXT
);

CREATE INDEX IF NOT EXISTS idx_city_cat ON poi(city, category);
CREATE INDEX IF NOT EXISTS idx_city_name ON poi(city, nameNorm);
