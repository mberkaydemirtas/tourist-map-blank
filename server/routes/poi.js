//server/ routes/poi.js
const express = require("express");
const router = express.Router();

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ====== Basit LRU Cache (arama) ======
const cache = new Map();
const TTL_MS = 60 * 1000; // 60 sn

function cacheKey(q, lat, lon, city, category) {
  return `${q}|${lat}|${lon}|${city}|${category}`;
}
function getCache(k){
  const v = cache.get(k);
  if (!v) return null;
  if (Date.now() > v.expires) { cache.delete(k); return null; }
  return v.data;
}
function setCache(k, data){ cache.set(k, { data, expires: Date.now()+TTL_MS }); }

// /api/poi/google/search içinde, fetch’lerden önce:
const key = cacheKey(q, lat, lon, city, category);
const cached = getCache(key);
if (cached) { return res.json(cached.slice(0,20)); }

// Google’dan yanıt aldığında en sonda:
setCache(key, out);
return res.json(out.slice(0,20));

class LRUCache {
  constructor(max = 600, ttlMs = 15 * 60 * 1000) {
    this.max = max; this.ttl = ttlMs; this.map = new Map();
  }
  _now(){ return Date.now(); }
  _expired(e){ return !e || e.exp < this._now(); }
  get(k){ const e=this.map.get(k); if(!e||this._expired(e)){ this.map.delete(k); return; } this.map.delete(k); this.map.set(k,e); return e.value; }
  set(k,v){ const exp=this._now()+this.ttl; if(this.map.has(k)) this.map.delete(k); this.map.set(k,{value:v,exp}); if(this.map.size>this.max){ this.map.delete(this.map.keys().next().value); } }
}
const searchCache = new LRUCache();

// ====== Basit IP rate-limit (15sn/30 istek) ======
const buckets = new Map();
const WINDOW_MS = 15_000, LIMIT = 30;
function rateLimit(req,res,next){
  const ip = req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  let b = buckets.get(ip);
  if(!b || b.reset < now) { b = { count: 0, reset: now + WINDOW_MS }; buckets.set(ip, b); }
  b.count++;
  const remaining = Math.max(LIMIT - b.count, 0);
  res.setHeader("X-RateLimit-Limit", LIMIT);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", Math.ceil((b.reset - now)/1000));
  if (b.count > LIMIT) return res.status(429).json({ error: "rate_limited" });
  next();
}

// ====== Yardımcılar ======
function num(v, d){ const n=Number(v); return Number.isFinite(n)?n:d; }
function norm(s=""){ return String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim(); }
function round6(n){ return Math.round(n*1e6)/1e6; }
function cacheKey({q,lat,lon,city,category}){ return `q=${norm(q)}|lat=${round6(lat)}|lon=${round6(lon)}|city=${norm(city)}|cat=${norm(category||"")}`; }

// ====== SEARCH: /api/poi/google/search ======
router.get("/google/search", rateLimit, async (req, res) => {
  try {
    if (!GOOGLE_KEY) return res.status(500).json({ error: "server_no_google_key" });
    const q = (req.query.q||"").trim();
    const lat = num(req.query.lat, 39.92077);
    const lon = num(req.query.lon, 32.85411);
    const city = (req.query.city||"Ankara").trim();
    const category = (req.query.category||"").trim();

    if (!q || q.length < 2) { res.setHeader("X-Cache","bypass-minlength"); return res.json([]); }

    const key = cacheKey({ q, lat, lon, city, category });
    const hit = searchCache.get(key);
    if (hit) { res.setHeader("X-Cache","HIT"); return res.json(hit); }

    // 1) Nearby
    const nearby = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    nearby.searchParams.set("key", GOOGLE_KEY);
    nearby.searchParams.set("language","tr");
    nearby.searchParams.set("location", `${lat},${lon}`);
    nearby.searchParams.set("radius", "150");
    nearby.searchParams.set("keyword", q);

    let out = [];
    const r1 = await fetch(nearby).then(r=>r.json()).catch(()=>null);
    if (r1?.results?.length) {
      out = r1.results.map(x => ({
        source:"google",
        name: x.name,
        lat: x.geometry?.location?.lat,
        lon: x.geometry?.location?.lng,
        place_id: x.place_id,
      }));
    }

    // 2) Text Search fallback
    if (!out.length) {
      const t = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
      t.searchParams.set("key", GOOGLE_KEY);
      t.searchParams.set("language","tr");
      t.searchParams.set("query", `${q} ${city}`.trim());
      t.searchParams.set("location", `${lat},${lon}`);
      t.searchParams.set("radius", "200");
      const r2 = await fetch(t).then(r=>r.json()).catch(()=>null);
      out = (r2?.results||[]).map(x => ({
        source:"google",
        name: x.name,
        lat: x.geometry?.location?.lat,
        lon: x.geometry?.location?.lng,
        place_id: x.place_id,
      }));
    }

    const finalOut = out.slice(0,20);
    searchCache.set(key, finalOut);
    res.setHeader("X-Cache","MISS");
    return res.json(finalOut);
  } catch (e) {
    console.error("google/search error:", e);
    return res.status(500).json({ error: "google_search_failed" });
  }
});

// ====== LAZY MATCH: /api/poi/match ======
const matchCache = new Map();

function matchKey(item){ 
  if (item.osm_id) return `o:${item.osm_id}`;
  return `x:${norm(item.name||"")}@${round6(Number(item.lat))},${round6(Number(item.lon))}`;
}
function haversineM(a,b,c,d){ const R=6371000, toR=x=>x*Math.PI/180; const dLat=toR(c-a), dLon=toR(d-b); const A=Math.sin(dLat/2)**2+Math.cos(toR(a))*Math.cos(toR(c))*Math.sin(dLon/2)**2; return 2*R*Math.asin(Math.sqrt(A)); }
function ngrams(s,n=3){ const t=` ${norm(s)} `; const o=[]; for(let i=0;i<=t.length-n;i++) o.push(t.slice(i,i+n)); return o; }
function trigramSim(a,b){ const A=new Set(ngrams(a)), B=new Set(ngrams(b)); if(!A.size||!B.size) return 0; let x=0; for(const z of A) if(B.has(z)) x++; return x/Math.max(A.size,B.size); }

async function googleCands(name, lat, lon, city){
  const nearby = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  nearby.searchParams.set("key", GOOGLE_KEY);
  nearby.searchParams.set("language","tr");
  nearby.searchParams.set("location", `${lat},${lon}`);
  nearby.searchParams.set("radius","120");
  nearby.searchParams.set("keyword", name);
  const r1 = await fetch(nearby).then(r=>r.json()).catch(()=>null);
  let out = r1?.results || [];
  if (!out.length) {
    const t = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    t.searchParams.set("key", GOOGLE_KEY);
    t.searchParams.set("language","tr");
    t.searchParams.set("query", `${name} ${city||""}`.trim());
    t.searchParams.set("location", `${lat},${lon}`);
    t.searchParams.set("radius","300");
    const r2 = await fetch(t).then(r=>r.json()).catch(()=>null);
    out = r2?.results || [];
  }
  return out.map(x => ({ name:x.name, lat:x.geometry?.location?.lat, lon:x.geometry?.location?.lng, place_id:x.place_id, types:x.types||[] }));
}

function chooseBest(osmItem, cands){
  const { name, lat, lon } = osmItem;
  let best=null;
  for(const c of cands){
    if(!Number.isFinite(c.lat)||!Number.isFinite(c.lon)) continue;
    const dist = haversineM(lat,lon,c.lat,c.lon);
    const sim = trigramSim(name,c.name);
    const distFactor = Math.max(0, 1 - Math.min(dist,300)/300);
    const score = 0.8*sim + 0.2*distFactor;
    const row = { cand:c, dist_m:Math.round(dist), name_sim:+sim.toFixed(3), score:+score.toFixed(3) };
    if(!best || row.score > best.score) best=row;
  }
  if(!best) return null;
  const ok = (best.dist_m <= 75 && best.name_sim >= 0.80) || (best.dist_m <= 40 && best.name_sim >= 0.75);
  return {
    matched: !!ok,
    place_id: ok ? best.cand.place_id : null,
    chosen: ok ? { name: best.cand.name, lat: best.cand.lat, lon: best.cand.lon } : null,
    dist_m: best.dist_m, name_sim: best.name_sim, score: best.score
  };
}

router.post("/match", rateLimit, express.json(), async (req, res) => {
  try {
    if (!GOOGLE_KEY) return res.status(500).json({ error: "server_no_google_key" });
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.json({ results: [] });

    const results = [];
    for (const it of items) {
      const key = matchKey(it);
      if (matchCache.has(key)) { results.push({ ...it, ...matchCache.get(key) }); continue; }

      const name = (it.name||"").trim();
      const lat = num(it.lat, NaN), lon = num(it.lon, NaN);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        results.push({ ...it, matched:false, place_id:null, dist_m:null, name_sim:0, score:0 });
        continue;
      }
      const city = (it.city || req.query.city || "Ankara").trim();
      const cands = await googleCands(name, lat, lon, city);
      const verdict = chooseBest({ name, lat, lon }, cands) || { matched:false, place_id:null, dist_m:null, name_sim:0, score:0 };
      matchCache.set(key, verdict);
      results.push({ ...it, ...verdict });
    }
    res.json({ results });
  } catch (e) {
    console.error("poi/match error:", e);
    res.status(500).json({ error: "poi_match_failed" });
  }
});

module.exports = router;
