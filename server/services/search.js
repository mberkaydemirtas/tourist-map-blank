// server/services/search.js
// Node < 18 kullanıyorsan aşağıyı aç:
if (typeof fetch === 'undefined') {
  global.fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));
}

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Küçük LRU cache (60s TTL)
class LRUCache {
  constructor(max = 600, ttlMs = 60 * 1000) { this.max = max; this.ttl = ttlMs; this.map = new Map(); }
  _now(){ return Date.now(); }
  _expired(e){ return !e || e.exp < this._now(); }
  get(k){ const e=this.map.get(k); if(!e||this._expired(e)){ this.map.delete(k); return; } this.map.delete(k); this.map.set(k,e); return e.value; }
  set(k,v){ const exp=this._now()+this.ttl; if(this.map.has(k)) this.map.delete(k); this.map.set(k,{value:v,exp}); if(this.map.size>this.max){ this.map.delete(this.map.keys().next().value); } }
}
const searchCache = new LRUCache();

function num(v, d){ const n = Number(v); return Number.isFinite(n) ? n : d; }
function norm(s=""){ try { return String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim(); } catch { return String(s||"").toLowerCase().trim(); } }
function round6(n){ return Math.round(Number(n)*1e6)/1e6; }
function cacheKey({q,lat,lon,city,category}){ return `q=${norm(q)}|lat=${round6(lat)}|lon=${round6(lon)}|city=${norm(city)}|cat=${norm(category||"")}`; }

// Türkçe karakterleri “Google’ın daha rahat eşleştireceği” forma yaklaştır
function normalizeTR(s=''){
  try {
    return s.normalize('NFKD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/[İIı]/g,'i').replace(/[Şş]/g,'s').replace(/[Ğğ]/g,'g')
      .replace(/[Üü]/g,'u').replace(/[Öö]/g,'o').replace(/[Çç]/g,'c');
  } catch { return s; }
}

function catToType(k=""){
  const m = { restaurant:"restaurant", cafe:"cafe", bar:"bar", museum:"museum", park:"park", sights:"tourist_attraction" };
  return m[(k||"").toLowerCase()] || "";
}

async function textSearch({ qRaw, lat, lon, hasLoc, typeFilter }) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("key", GOOGLE_KEY);
  url.searchParams.set("language", "tr");
  url.searchParams.set("region", "tr");
  url.searchParams.set("query", qRaw);
  if (hasLoc) { url.searchParams.set("location", `${lat},${lon}`); url.searchParams.set("radius", "8000"); }
  // type textsearch’te resmi olmasa da kabul ediliyor; sorun çıkarırsa yoruma alırız
  if (typeFilter) url.searchParams.set("type", typeFilter);

  let js = null;
  try {
    js = await fetch(url).then(r => r.json());
  } catch (e) {
    console.error('[TEXTSEARCH] fetch failed:', e?.message || e);
  }
  console.log('[TEXTSEARCH] status:', js?.status, 'err:', js?.error_message, 'n=', js?.results?.length || 0);

  const arr = Array.isArray(js?.results) ? js.results : [];
  return arr.map(x => ({
    source: "google",
    name: x.name,
    lat: x.geometry?.location?.lat,
    lon: x.geometry?.location?.lng,
    place_id: x.place_id,
    address: x.formatted_address || x.vicinity || "",
    types: x.types || [],
  })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

async function nearbySearch({ qRaw, lat, lon, typeFilter, hasLoc }) {
  if (!hasLoc) return [];
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("key", GOOGLE_KEY);
  url.searchParams.set("language", "tr");
  url.searchParams.set("location", `${lat},${lon}`);
  url.searchParams.set("radius", "8000");
  if (typeFilter) url.searchParams.set("type", typeFilter);
  if (qRaw) url.searchParams.set("keyword", qRaw);

  let js = null;
  try {
    js = await fetch(url).then(r => r.json());
  } catch (e) {
    console.error('[NEARBY] fetch failed:', e?.message || e);
  }
  console.log('[NEARBY] status:', js?.status, 'err:', js?.error_message, 'n=', js?.results?.length || 0);

  const arr = Array.isArray(js?.results) ? js.results : [];
  return arr.map(x => ({
    source: "google",
    name: x.name,
    lat: x.geometry?.location?.lat,
    lon: x.geometry?.location?.lng,
    place_id: x.place_id,
    address: x.vicinity || "",
    types: x.types || [],
  })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

async function googlePlacesSearch(req, res) {
  try {
    if (!GOOGLE_KEY) {
      console.error('[SEARCH] GOOGLE_MAPS_API_KEY yok!');
      return res.status(500).json({ error: "server_no_google_key" });
    }

    // q boşsa city’yi deneriz (ama asıl “anıtka” gibi parçalı q bekliyoruz)
    const qRawIn = String(req.query.q || "").trim() || String(req.query.city || "").trim();
    const qRaw = normalizeTR(qRawIn); // TR normalize
    const city     = String(req.query.city || "").trim();
    const lat      = num(req.query.lat,  NaN);
    const lon      = num(req.query.lon,  NaN);
    const category = String(req.query.category || "").trim();

    const key = cacheKey({ q: `search:${qRaw}`, lat, lon, city, category });
    const cached = searchCache.get(key);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("X-Google-Count", String(cached.length));
      return res.json(cached);
    }

    const hasLoc = Number.isFinite(lat) && Number.isFinite(lon);
    const qLen   = qRaw.length;
    const typeFilter = catToType(category);

    let out = [];
    if (qLen >= 3) {
      out = await textSearch({ qRaw, lat, lon, hasLoc, typeFilter });
      if (out.length === 0) out = await nearbySearch({ qRaw, lat, lon, typeFilter, hasLoc });
    } else {
      if (hasLoc && (typeFilter || qLen >= 1)) {
        out = await nearbySearch({ qRaw, lat, lon, typeFilter, hasLoc });
        if (out.length === 0) out = await textSearch({ qRaw, lat, lon, hasLoc, typeFilter });
      } else {
        out = await textSearch({ qRaw, lat, lon, hasLoc, typeFilter });
      }
    }

    const finalOut = out.slice(0, 15);
    searchCache.set(key, finalOut);
    res.setHeader("X-Cache", "MISS");
    res.setHeader("X-Google-Count", String(finalOut.length));
    return res.json(finalOut);
  } catch (e) {
    console.error("google/search error:", e);
    return res.status(500).json({ error: "google_search_failed" });
  }
}

module.exports = { googlePlacesSearch };
