import { Platform } from "react-native";

/**
 * ENV:
 * - EXPO_PUBLIC_API_BASE            : https://… (tam URL)
 * - EXPO_PUBLIC_SERVER_ENABLED      : "true" | "false"
 * - EXPO_PUBLIC_API_TIMEOUT_MS      : sayı (ms)
 * - EXPO_PUBLIC_GOOGLE_MAPS_API_KEY : (opsiyonel) client-side fallback için
 */

const PROD_BASE = "https://tourist-map-blank-12.onrender.com";
const LOCAL_BASE =
  Platform.OS === "android" ? "http://10.0.2.2:5000" : "http://localhost:5000";

let isEmulatorOrSim = false;
try {
  const Constants = require("expo-constants").default;
  isEmulatorOrSim = !Constants.isDevice;
} catch {}

const ENV_API_BASE = (process.env?.EXPO_PUBLIC_API_BASE || "").trim();
const ENV_SERVER_ENABLED_RAW = (process.env?.EXPO_PUBLIC_SERVER_ENABLED || "")
  .trim()
  .toLowerCase();
const ENV_TIMEOUT_RAW = (process.env?.EXPO_PUBLIC_API_TIMEOUT_MS || "").trim();
const GOOGLE_WEB_KEY = (process.env?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim();

export const API_BASE =
  ENV_API_BASE || (__DEV__ ? (isEmulatorOrSim ? LOCAL_BASE : PROD_BASE) : PROD_BASE);

export const SERVER_ENABLED =
  ENV_SERVER_ENABLED_RAW === "false" ? false : Boolean(API_BASE && API_BASE.length);

const _tParsed = Number(ENV_TIMEOUT_RAW);
export const API_TIMEOUT_MS =
  Number.isFinite(_tParsed) && _tParsed > 0 ? _tParsed : 15000;

if (__DEV__) {
  console.log(
    `[API] BASE=${API_BASE} TIMEOUT=${API_TIMEOUT_MS}ms SERVER_ENABLED=${SERVER_ENABLED} `
  );
}

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */
function serverAvailable() {
  return SERVER_ENABLED && typeof API_BASE === "string" && API_BASE.length > 0;
}

function asAbortSignal(maybe) {
  if (!maybe) return null;
  if (typeof maybe === "object" && typeof maybe.abort === "function" && maybe.signal) {
    return maybe.signal;
  }
  if (
    typeof maybe === "object" &&
    typeof maybe.aborted === "boolean" &&
    typeof maybe.addEventListener === "function"
  ) {
    return maybe;
  }
  return null;
}

function composeAbortController(upstream, timeoutMs = API_TIMEOUT_MS) {
  const upstreamSignal = asAbortSignal(upstream);
  const controller = new AbortController();
  const onUpstreamAbort = () => controller.abort();

  let timer = null;
  const T = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : API_TIMEOUT_MS;

  if (T > 0) timer = setTimeout(() => controller.abort(), T);
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort();
    else upstreamSignal.addEventListener("abort", onUpstreamAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      if (upstreamSignal) upstreamSignal.removeEventListener("abort", onUpstreamAbort);
    },
    abort() {
      controller.abort();
    },
  };
}

async function fetchJson(
  urlStr,
  { method = "GET", headers, body, signal, timeoutMs } = {}
) {
  const url = String(urlStr);
  const isAndroid = Platform.OS === "android";

  const isPoiGoogle = url.includes("/api/poi/google/");
  const isPoiMatch = url.includes("/api/poi/match");
  const forceNoSignal = isAndroid && (isPoiGoogle || isPoiMatch);

  const T = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : API_TIMEOUT_MS;
  const { signal: finalSignal, cleanup } = forceNoSignal
    ? { signal: undefined, cleanup: () => {} }
    : composeAbortController(signal, T);

  const h = { Accept: "application/json", ...(headers || {}) };
  if (isPoiGoogle || isPoiMatch) h["Accept-Encoding"] = "identity";
  const baseOpts = { method, headers: h, body };

  try {
    if (forceNoSignal) {
      const p = fetch(url, baseOpts);
      const t = new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`tmout_no_signal_${T}`)), T)
      );
      return await Promise.race([p, t]);
    }
    return await fetch(url, { ...baseOpts, signal: finalSignal });
  } catch (e) {
    const msg = String(e?.message || "");
    const looksLikeSignalUnsupported =
      msg.includes("Property 'signal' doesn't exist") ||
      msg.includes("invalid value for signal") ||
      (msg.includes("signal") && msg.includes("not"));
    const looksLikeAbortOrRnBug =
      e?.name === "AbortError" || msg.includes("Network request failed");

    if (looksLikeSignalUnsupported || looksLikeAbortOrRnBug || forceNoSignal) {
      try {
        if (__DEV__)
          console.warn("[fetchJson] re-try without signal due to:", msg || "(forced)");
        const p2 = fetch(url, baseOpts);
        const t2 = new Promise((_, rej) =>
          setTimeout(() => rej(new Error(`tmout_retry_no_signal_${T}`)), T)
        );
        return await Promise.race([p2, t2]);
      } finally {
        cleanup();
      }
    }
    cleanup();
    throw e;
  } finally {
    cleanup();
  }
}

const _inflight = new Map();
const DEDUP_MS = 5000;

async function fetchJsonDedup(url, opts = {}, timeoutMs) {
  const key = String(url);
  const now = Date.now();
  const exist = _inflight.get(key);
  if (exist && now - exist.t0 < DEDUP_MS) {
    return exist.p;
  }
  const p = (async () => {
    try {
      return await fetchJson(key, { ...(opts || {}), timeoutMs });
    } finally {
      _inflight.delete(key);
    }
  })();
  _inflight.set(key, { p, t0: now });
  return p;
}

function toArray(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.results)) return json.results;
  if (json && Array.isArray(json.predictions)) return json.predictions;
  return [];
}

const isNetFail = (e) => String(e?.message || "").includes("Network request failed");

/* ========================= SUGGEST-FIRST AYARLAR ========================= */

const MIN_CHARS_SUGGEST = 2;
const SUGGEST_MIN_TO_SKIP_GOOGLE = 3;
const SUGGEST_PREFIX_TTL_MS = 90_000;

function trFold(s = "") {
  const map = {
    İ: "I",
    I: "I",
    ı: "i",
    Ş: "S",
    ş: "s",
    Ğ: "G",
    ğ: "g",
    Ü: "U",
    ü: "U",
    Ö: "O",
    ö: "O",
    Ç: "C",
    ç: "C",
  };
  const str = String(s || "");
  try {
    return str
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, (ch) => map[ch] || ch)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return str
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, (ch) => map[ch] || ch)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }
}

function normCity(city) {
  return String(city || "");
}

function uniqByPlaceId(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const pid = x?.place_id || x?.placeId;
    const key = pid ? `pid:${pid}` : `row:${JSON.stringify(x)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
}

const _prefixSatisfy = new Map(); // key: city|normPrefix → expireTs

function markPrefixSatisfied(q, city) {
  const norm = trFold(q);
  const c = normCity(city);
  const key = `${c}|${norm}`;
  _prefixSatisfy.set(key, Date.now() + SUGGEST_PREFIX_TTL_MS);
}

function anySatisfiedPrefix(q, city) {
  const norm = trFold(q);
  const c = normCity(city);
  const now = Date.now();
  for (const [k, exp] of _prefixSatisfy.entries()) {
    if (exp < now) {
      _prefixSatisfy.delete(k);
      continue;
    }
    const [kc, kp] = k.split("|");
    if (kc !== c) continue;
    if (norm.startsWith(kp)) return true;
  }
  return false;
}

/* -------------------- Kategori filtreleme (suggest) -------------------- */
const TYPE_TO_CAT = {
  restaurant: "restaurants",
  food: "restaurants",
  cafe: "cafes",
  bar: "bars",
  museum: "museums",
  park: "parks",
  tourist_attraction: "sights",
};

function filterSuggestByCategory(items, category) {
  if (!category) return items;
  const want = String(category || "");
  return (items || []).filter((it) => {
    const types = Array.isArray(it?.types) ? it.types : [];
    const cats = new Set(types.map((t) => TYPE_TO_CAT[t]).filter(Boolean));
    if (!cats.size) return false;
    return cats.has(want);
  });
}

/* ========================= PUBLIC: SUGGEST API ========================= */

export async function poiSuggest(
  q,
  { city, limit = 12, timeoutMs, signal } = {}
) {
  if (!serverAvailable()) return [];

  const T = Number.isFinite(Number(timeoutMs))
    ? Number(timeoutMs)
    : Math.min(API_TIMEOUT_MS, 9000);

  const build = (base) => {
    const u = new URL(`${base}/api/poi/suggest`);
    u.searchParams.set("q", String(q || ""));
    if (city) u.searchParams.set("city", String(city));
    u.searchParams.set("limit", String(limit));
    return String(u);
  };

  try {
    const url = build(API_BASE);
    if (__DEV__) console.log("[poiSuggest] url=", url);
    const res = await fetchJsonDedup(url, { signal, timeoutMs: T }, T);
    if (!res.ok) throw new Error(`poiSuggest_failed_${res.status}`);
    const json = await res.json();
    const arr = toArray(json);
    const uniq = uniqByPlaceId(arr);
    if (__DEV__) {
      try {
        console.log("[poiSuggest] status=", res.status, "len=", uniq.length);
      } catch {}
    }
    return uniq;
  } catch (e) {
    if (__DEV__) console.warn("[poiSuggest] error:", e?.message || e);
    return [];
  }
}

/* ================== AUTOCOMPLETE (suggest-first + SAFE gating) ================== */
export function newPlacesSessionToken() {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {}
  const rnd = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `sess_${ts}_${rnd}`;
}

async function suggestGateFirst(q, { city, category, limit, timeoutMs, signal }) {
  const raw = await poiSuggest(q, { city, limit, timeoutMs, signal });
  const rawCount = (raw || []).length;

  const filtered = filterSuggestByCategory(raw, category);
  const filteredCount = (filtered || []).length;

  const satisfied = rawCount >= SUGGEST_MIN_TO_SKIP_GOOGLE;

  if (satisfied) {
    markPrefixSatisfied(q, city);
    if (__DEV__) console.log(
      `[suggestGate] satisfied raw=${rawCount} filtered=${filteredCount} → skip google`
    );
  } else {
    if (__DEV__) console.log(
      `[suggestGate] not satisfied raw=${rawCount} filtered=${filteredCount} → may fallback to google`
    );
  }

  return { satisfied, results: filteredCount ? filtered : raw };
}

export async function poiAutocomplete(
  q,
  { lat, lon, city, limit = 8, sessionToken, timeoutMs, signal, category } = {}
) {
  const qTrim = String(q || "").trim();

  if (qTrim.length < MIN_CHARS_SUGGEST) {
    return [];
  }

  if (anySatisfiedPrefix(qTrim, city)) {
    const { results } = await suggestGateFirst(qTrim, { city, category, limit, timeoutMs, signal });
    
    return (results || []).map((s) => ({
      source: "suggest",
      name: s.name,
      place_id: s.place_id,
      address: s.address || "",
      city: s.city || city || "",
      lat: s.lat, lon: s.lon,
      rating: s.rating, user_ratings_total: s.user_ratings_total
    }));
  }

  const { satisfied, results } = await suggestGateFirst(qTrim, {
    city, category, limit, timeoutMs, signal
  });
  if (satisfied) {
    return (results || []).map((s) => ({
      source: "suggest",
      name: s.name,
      place_id: s.place_id,
      address: s.address || "",
      city: s.city || city || "",
      lat: s.lat, lon: s.lon,
      rating: s.rating, user_ratings_total: s.user_ratings_total
    }));
  }
    // erken prefix'te Google'ı kes
   if (qTrim.length < MIN_PREFIX_FOR_GOOGLE) {
     return (results || []).map((s) => ({
       source: "suggest",
       name: s.name,
       place_id: s.place_id,
       address: s.address || "",
       city: s.city || city || "",
       lat: s.lat, lon: s.lon,
       rating: s.rating, user_ratings_total: s.user_ratings_total
     }));   }

  const T = Number.isFinite(Number(timeoutMs))
    ? Number(timeoutMs)
    : Math.max(API_TIMEOUT_MS, 9000);

  const build = (base) => {
    const u = new URL(`${base}/api/poi/google/autocomplete`);
    u.searchParams.set("q", String(qTrim));
    if (lat != null) u.searchParams.set("lat", String(lat));
    if (lon != null) u.searchParams.set("lon", String(lon));
    if (city) u.searchParams.set("city", String(city));
    u.searchParams.set("limit", String(limit));
    if (sessionToken) u.searchParams.set("sessiontoken", String(sessionToken));
    if (category) u.searchParams.set("category", String(category));
    return String(u);
  };

  if (serverAvailable()) {
    try {
      const url = build(API_BASE);
      if (__DEV__) console.log("[poiAutocomplete] url=", url);
      const res = await fetchJsonDedup(url, { signal, timeoutMs: T }, T);
      if (!res.ok)
        throw new Error(
          `poiAutocomplete_failed_${res.status}_${await res.text().catch(() => "")}`
        );
      const json = await res.json();
      const arr = toArray(json);
      return arr;
    } catch (e1) {
      // (failover ve direct-google aynı şekilde)
      return [];
    }
  }

  return [];
}

/* ========== SEARCH — sadece submit olduğunda çağrılmalı ========== */
export async function poiSearch(
  q,
  { lat, lon, category, city, timeoutMs, signal, isSubmit = false } = {}
) {
  const qTrim = String(q || "").trim();

  if (qTrim.length < MIN_CHARS_SUGGEST) {
    return [];
  }

  // Keystroke sırasında yanlışlıkla çağrılırsa bile sunucuda BLOCK var.
  const T1 = Number.isFinite(Number(timeoutMs))
    ? Number(timeoutMs)
    : Math.max(API_TIMEOUT_MS, 10000);

  const build = (base) => {
    const u = new URL(`${base}/api/poi/google/search`);
    u.searchParams.set("q", String(qTrim));
    if (lat != null) u.searchParams.set("lat", String(lat));
    if (lon != null) u.searchParams.set("lon", String(lon));
    if (city) u.searchParams.set("city", String(city));
    if (category) u.searchParams.set("category", String(category));
    if (isSubmit) u.searchParams.set("submit", "1"); // ← server gate
    return String(u);
  };

  if (serverAvailable()) {
    try {
      const url = build(API_BASE);
      if (__DEV__) console.log("[poiSearch] url=", url);
      const res = await fetchJsonDedup(
        url,
        { signal, timeoutMs: T1, headers: isSubmit ? { 'x-submit-search': '1' } : undefined },
        T1
      );
      if (res.status === 204) {
        if (__DEV__) console.warn("[poiSearch] BLOCKED by server (no submit)");
        return [];
      }
      if (!res.ok) throw new Error(`poiSearch_failed_${res.status}`);
      const json = await res.json();
      return toArray(json);
    } catch (e1) {
      return [];
    }
  }

  return [];
}

/* -------------------- Genel amaçlı fetch wrapper -------------------- */
export async function apiFetch(
  path,
  { method = "GET", headers = {}, body, deviceId, timeoutMs } = {}
) {
  if (!serverAvailable()) throw new Error("server_disabled");

  const h = {
    "Content-Type": "application/json",
    ...(deviceId ? { "x-device-id": deviceId } : null),
    ...headers,
  };

  const { signal, cleanup } = composeAbortController(
    undefined,
    Number(timeoutMs ?? API_TIMEOUT_MS)
  );
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    return res;
  } finally {
    cleanup();
  }
}

/* ---------------- POI yardımcıları (server) ---------------- */
export async function poiMatch(items, city) {
  if (!serverAvailable()) return { results: [] };

  const url = `${API_BASE}/api/poi/match`;
  try {
    const res = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      timeoutMs: API_TIMEOUT_MS,
      body: JSON.stringify({
        items: (items || []).map((x) => ({
          osm_id: x.osm_id,
          name: x.name,
          lat: x.lat,
          lon: x.lon,
          city: city || "Ankara",
        })),
      }),
    });
    if (!res.ok) throw new Error(`poiMatch_failed_${res.status}`);
    return res.json();
  } catch (e) {
    if (__DEV__) console.warn("[poiMatch] skip on error:", e?.message || e);
    return { results: [] };
  }
}

export async function poiMatchUpsert(matches) {
  if (!serverAvailable()) return { upserted: 0 };

  const url = `${API_BASE}/api/poi/match`;
  const res = await fetchJson(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept-Encoding": "identity" },
    timeoutMs: API_TIMEOUT_MS,
    body: JSON.stringify({ matches: Array.isArray(matches) ? matches : [] }),
  });
  if (!res.ok) throw new Error(`poiMatchUpsert_failed_${res.status}`);
  return res.json();
}

/* ===================== Tek giriş noktası ===================== */
const _strokeGuard = new Map();

export async function searchUnified(
  q,
  {
    city,
    category,
    lat,
    lon,
    sessionToken,
    isSubmit = false,
    limit = 12,
    timeoutMs,
    signal,
  } = {}
) {
  const qTrim = String(q || "").trim();
  if (qTrim.length < MIN_CHARS_SUGGEST) return [];

  const guardKey = `${city || ""}|${qTrim}`;
  const now = Date.now();
  const last = _strokeGuard.get(guardKey) || 0;
  if (now - last < 250) {
    return [];
  }
  _strokeGuard.set(guardKey, now);

  if (!isSubmit) {
    const ac = await poiAutocomplete(qTrim, {
      city, category, lat, lon, sessionToken, limit: Math.min(8, limit), timeoutMs, signal,
    });
    return ac;
  }

  const results = await poiSearch(qTrim, {
    city, category, lat, lon, timeoutMs, signal, isSubmit: true,
  });
  return results;
}
