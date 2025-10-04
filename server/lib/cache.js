// server/lib/cache.js
class LRUCache {
  constructor({ max = 1000, ttlMs = 600000 } = {}) {
    this.max = max; this.ttlMs = ttlMs;
    this.map = new Map(); // key -> {value, exp}
  }
  get(k) {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (Date.now() > e.exp) { this.map.delete(k); return undefined; }
    // LRU touch:
    this.map.delete(k); this.map.set(k, e);
    return e.value;
  }
  set(k, v, ttlOverrideMs) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { value: v, exp: Date.now() + (ttlOverrideMs ?? this.ttlMs) });
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }
}

const inflight = new Map(); // key -> Promise

function withCoalescing(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try { return await fn(); }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

function normalizeKey(req, extra = {}) {
  const u = new URL(req.originalUrl, 'http://x');
  const entries = [...u.searchParams.entries()]
    .filter(([k,v]) => v != null && v !== '')
    .sort((a,b)=> a[0].localeCompare(b[0]) || String(a[1]).localeCompare(String(b[1])));
  const q = entries.map(([k,v])=>`${k}=${v}`).join('&');
  return `${req.method} ${u.pathname}?${q}|${JSON.stringify(extra)}`;
}

module.exports = { LRUCache, withCoalescing, normalizeKey };
