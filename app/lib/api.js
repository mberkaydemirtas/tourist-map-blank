// app/lib/api.js
import { Platform } from "react-native";

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

// Varsayılan 9s (Google’a 12s yetiyor, local match için daha kısa kullanacağız)
const _tParsed = Number(ENV_TIMEOUT_RAW);
export const API_TIMEOUT_MS = Number.isFinite(_tParsed) && _tParsed > 0 ? _tParsed : 9000;

if (__DEV__) {
  console.log(
    `[API] BASE=${API_BASE} TIMEOUT=${API_TIMEOUT_MS}ms SERVER_ENABLED=${SERVER_ENABLED} `
  );
}

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
    abort() { controller.abort(); },
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

  // ⬇️ Sadece Google proxy’lerinde no-signal hack (RN Android bugları için)
  const forceNoSignal = isAndroid && isPoiGoogle;

  const T = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : API_TIMEOUT_MS;
  const { signal: finalSignal, cleanup } = forceNoSignal
    ? { signal: undefined, cleanup: () => {} }
    : composeAbortController(signal, T);

  const h = { Accept: "application/json", ...(headers || {}) };
  if (isPoiGoogle) h["Accept-Encoding"] = "identity";
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

/* --------------------- İSTEK DEDUP (5 sn) ---------------------- */
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

/* ================== AUTOCOMPLETE ================== */
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

export async function poiAutocomplete(q, { lat, lon, city, limit = 8, sessionToken, timeoutMs, signal } = {}) {
  const T = Number.isFinite(Number(timeoutMs))
    ? Number(timeoutMs)
    : Math.max(API_TIMEOUT_MS, 9000);

  const build = (base) => {
    const u = new URL(`${base}/api/poi/google/autocomplete`);
    u.searchParams.set("q", String(q || ""));
    if (lat != null) u.searchParams.set("lat", String(lat));
    if (lon != null) u.searchParams.set("lon", String(lon));
    if (city) u.searchParams.set("city", String(city));
    u.searchParams.set("limit", String(limit));
    if (sessionToken) u.searchParams.set("sessiontoken", String(sessionToken));
    return String(u);
  };

  if (serverAvailable()) {
    try {
      const url = build(API_BASE);
      if (__DEV__) console.log("[poiAutocomplete] url=", url);
      const res = await fetchJsonDedup(url, { signal, timeoutMs: T }, T);
      if (!res.ok) throw new Error(`poiAutocomplete_failed_${res.status}_${await res.text().catch(() => "")}`);
      const json = await res.json();
      const arr = toArray(json);
      if (__DEV__) {
        try {
          console.log("[poiAutocomplete] status=", res.status, "X-Cache=", res.headers.get("X-Cache"), "X-Google-Count=", res.headers.get("X-Google-Count"));
        } catch {}
      }
      return arr;
    } catch (e1) {
      if (isNetFail(e1)) {
        if (API_BASE.includes("localhost")) {
          try {
            const url2 = build("http://10.0.2.2:5000");
            const resL = await fetchJsonDedup(url2, { signal, timeoutMs: T }, T);
            if (!resL.ok) throw new Error(`poiAutocomplete_failed_${resL.status}`);
            if (__DEV__) console.warn("[poiAutocomplete] FAILOVER → 10.0.2.2");
            return toArray(await resL.json());
          } catch {}
        }
        if (API_BASE.includes("10.0.2.2")) {
          try {
            const url3 = build("http://localhost:5000");
            const resLoc = await fetchJsonDedup(url3, { signal, timeoutMs: T }, T);
            if (!resLoc.ok) throw new Error(`poiAutocomplete_failed_${resLoc.status}`);
            if (__DEV__) console.warn("[poiAutocomplete] FAILOVER → localhost");
            return toArray(await resLoc.json());
          } catch {}
        }
        if (API_BASE.includes("localhost") || API_BASE.includes("10.0.2.2")) {
          try {
            const url4 = build(PROD_BASE);
            const resP = await fetchJsonDedup(url4, { signal, timeoutMs: T }, T);
            if (!resP.ok) throw new Error(`poiAutocomplete_failed_${resP.status}`);
            if (__DEV__) console.warn("[poiAutocomplete] FAILOVER → PROD");
            return toArray(await resP.json());
          } catch {}
        }
      }
      if (GOOGLE_WEB_KEY) {
        try {
          const p = new URLSearchParams({
            input: String(q || ""),
            key: GOOGLE_WEB_KEY,
            language: "tr",
            region: "TR",
            types: "establishment",
          });
          if (lat != null && lon != null) { p.set("location", `${lat},${lon}`); p.set("radius", "30000"); }
          if (sessionToken) p.set("sessiontoken", String(sessionToken));
          const gUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${p}`;
          if (__DEV__) console.warn("[poiAutocomplete] DIRECT GOOGLE →", gUrl);
          const rG = await fetchJsonDedup(gUrl, {}, T);
          const jG = await rG.json();
          const preds = Array.isArray(jG?.predictions) ? jG.predictions : [];
          return preds.map((p) => ({
            source: "google",
            name: p?.structured_formatting?.main_text || p?.description || "",
            place_id: p?.place_id,
            address: p?.description || "",
            city: city || "",
          }));
        } catch {}
      }
      return [];
    }
  }

  if (GOOGLE_WEB_KEY) {
    const p = new URLSearchParams({
      input: String(q || ""),
      key: GOOGLE_WEB_KEY,
      language: "tr",
      region: "TR",
      types: "establishment",
    });
    if (lat != null && lon != null) { p.set("location", `${lat},${lon}`); p.set("radius", "30000"); }
    if (sessionToken) p.set("sessiontoken", String(sessionToken));
    const gUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${p}`;
    const rG = await fetchJsonDedup(gUrl, {}, T);
    const jG = await rG.json();
    const preds = Array.isArray(jG?.predictions) ? jG.predictions : [];
    return preds.map((p) => ({
      source: "google",
      name: p?.structured_formatting?.main_text || p?.description || "",
      place_id: p?.place_id,
      address: p?.description || "",
      city: city || "",
    }));
  }
  return [];
}

/* ========== SEARCH (TextSearch) ========== */
export async function poiSearch(q, { lat, lon, category, city, timeoutMs, signal } = {}) {
  const T1 = Number.isFinite(Number(timeoutMs))
    ? Number(timeoutMs)
    : Math.max(API_TIMEOUT_MS, 10000);

  const build = (base) => {
    const u = new URL(`${base}/api/poi/google/search`);
    u.searchParams.set("q", String(q || ""));
    if (lat != null) u.searchParams.set("lat", String(lat));
    if (lon != null) u.searchParams.set("lon", String(lon));
    if (city) u.searchParams.set("city", String(city));
    if (category) u.searchParams.set("category", String(category));
    return String(u);
  };

  if (serverAvailable()) {
    try {
      const url = build(API_BASE);
      if (__DEV__) console.log("[poiSearch] url=", url);
      const res = await fetchJsonDedup(url, { signal, timeoutMs: T1 }, T1);
      if (!res.ok) throw new Error(`poiSearch_failed_${res.status}`);
      const json = await res.json();
      if (__DEV__) {
        try {
          console.log("[poiSearch] status=", res.status, "X-Cache=", res.headers.get("X-Cache"), "X-Google-Count=", res.headers.get("X-Google-Count"));
        } catch {}
      }
      return toArray(json);
    } catch (e1) {
      if (isNetFail(e1)) {
        if (API_BASE.includes("localhost")) {
          try {
            const url2 = build("http://10.0.2.2:5000");
            const resL = await fetchJsonDedup(url2, { signal, timeoutMs: T1 }, T1);
            if (!resL.ok) throw new Error(`poiSearch_failed_${resL.status}`);
            if (__DEV__) console.warn("[poiSearch] FAILOVER → 10.0.2.2");
            return toArray(await resL.json());
          } catch {}
        }
        if (API_BASE.includes("10.0.2.2")) {
          try {
            const url3 = build("http://localhost:5000");
            const resLoc = await fetchJsonDedup(url3, { signal, timeoutMs: T1 }, T1);
            if (!resLoc.ok) throw new Error(`poiSearch_failed_${resLoc.status}`);
            if (__DEV__) console.warn("[poiSearch] FAILOVER → localhost");
            return toArray(await resLoc.json());
          } catch {}
        }
        if (API_BASE.includes("localhost") || API_BASE.includes("10.0.2.2")) {
          try {
            const url4 = build(PROD_BASE);
            const resP = await fetchJsonDedup(url4, { signal, timeoutMs: T1 }, T1);
            if (!resP.ok) throw new Error(`poiSearch_failed_${resP.status}`);
            if (__DEV__) console.warn("[poiSearch] FAILOVER → PROD");
            return toArray(await resP.json());
          } catch {}
        }
      }
      return [];
    }
  }
  return [];
}

/* ---------------- Genel amaçlı fetch ---------------- */
export async function apiFetch(path, { method = "GET", headers = {}, body, deviceId, timeoutMs } = {}) {
  if (!serverAvailable()) throw new Error("server_disabled");
  const h = {
    "Content-Type": "application/json",
    ...(deviceId ? { "x-device-id": deviceId } : null),
    ...headers,
  };
  const { signal, cleanup } = composeAbortController(undefined, Number(timeoutMs ?? API_TIMEOUT_MS));
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

/* ---------------- POI Match Helpers ---------------- */
export async function poiMatch(items, city) {
  if (!serverAvailable()) return { results: [] };

  const url = `${API_BASE}/api/poi/match`;
  const res = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    timeoutMs: API_TIMEOUT_MS,
    body: JSON.stringify({
      items: (items || []).map((x) => ({
        item_id: x.item_id || x.id || x.osm_id || undefined, // ⬅️ seed id
        osm_id: x.osm_id,
        name: x.name,
        lat: x.lat,
        lon: x.lon,
        city: city || "Ankara",
      })),
    }),
  });
  if (!res.ok) throw new Error(`poiMatch_failed_${res.status}`);
  return res.json(); // { results: [...] }
}

export async function poiMatchUpsert(matches) {
  if (!serverAvailable()) return { upserted: 0 };

  const url = `${API_BASE}/api/poi/match`;
  const res = await fetchJson(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept-Encoding": "identity" },
    timeoutMs: API_TIMEOUT_MS,
    body: JSON.stringify({
      matches: Array.isArray(matches)
        ? matches.map(m => ({
            ...m,
            item_id: m.item_id || m.id || m.osm_id || undefined, // ⬅️ seed id’yi geçir
          }))
        : []
    }),
  });
  if (!res.ok) throw new Error(`poiMatchUpsert_failed_${res.status}`);
  return res.json(); // { upserted: N }
}

/* ================== SUGGEST (DB-first + Google fallback) ================== */
export async function poiSuggest(q, { lat, lon, city, limit = 12, timeoutMs, signal } = {}) {
  if (!SERVER_ENABLED) return [];

  const T = Number.isFinite(Number(timeoutMs))
    ? Number(timeoutMs)
    : Math.max(API_TIMEOUT_MS, 8000);

  const build = (base) => {
    const u = new URL(`${base}/api/poi/suggest`);
    u.searchParams.set('q', String(q || ''));
    if (lat != null) u.searchParams.set('lat', String(lat));
    if (lon != null) u.searchParams.set('lon', String(lon));
    if (city) u.searchParams.set('city', String(city));
    u.searchParams.set('limit', String(limit));
    return String(u);
  };

  const attempt = async (base) => {
    const url = build(base);
    if (__DEV__) console.log('[poiSuggest] url=', url);
    const res = await fetchJsonDedup(url, { signal, timeoutMs: T }, T);
    if (!res.ok) throw new Error(`poiSuggest_failed_${res.status}`);
    const json = await res.json();
    if (__DEV__) {
      try {
        console.log('[poiSuggest] status=', res.status,
          'X-Cache=', res.headers.get('X-Cache'),
          'X-Google-Count=', res.headers.get('X-Google-Count'));
      } catch {}
    }
    const arr = Array.isArray(json?.results) ? json.results : (Array.isArray(json) ? json : []);
    return arr;
  };

  try {
    return await attempt(API_BASE);
  } catch (e1) {
    if (isNetFail(e1)) {
      if (API_BASE.includes('localhost')) {
        try { return await attempt('http://10.0.2.2:5000'); } catch {}
      }
      if (API_BASE.includes('10.0.2.2')) {
        try { return await attempt('http://localhost:5000'); } catch {}
      }
      if (API_BASE.includes('localhost') || API_BASE.includes('10.0.2.2')) {
        try { return await attempt(PROD_BASE); } catch {}
      }
    }
    if (__DEV__) console.warn('[poiSuggest] skip on error:', e1?.message || e1);
    return [];
  }
}