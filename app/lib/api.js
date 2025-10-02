// app/lib/api.js
import { Platform } from "react-native";

/**
 * ENV:
 * - EXPO_PUBLIC_API_BASE           : https://… (tam URL)
 * - EXPO_PUBLIC_SERVER_ENABLED     : "true" | "false"
 * - EXPO_PUBLIC_API_TIMEOUT_MS     : sayı (ms)
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

// API_BASE seçimi:
// 1) ENV override
// 2) Dev: emulator/simulator → LOCAL_BASE, gerçek cihaz → PROD_BASE
// 3) Prod: PROD_BASE
export const API_BASE =
  ENV_API_BASE || (__DEV__ ? (isEmulatorOrSim ? LOCAL_BASE : PROD_BASE) : PROD_BASE);

export const SERVER_ENABLED =
  ENV_SERVER_ENABLED_RAW === "false" ? false : Boolean(API_BASE && API_BASE.length);

// ⛑️ 0 veya geçersiz değerlerde 15000ms kullan (ÖNCE 5000’di)
const _tParsed = Number(ENV_TIMEOUT_RAW);
export const API_TIMEOUT_MS = Number.isFinite(_tParsed) && _tParsed > 0 ? _tParsed : 15000;

if (__DEV__) {
  console.log(
    `[API] BASE=${API_BASE} TIMEOUT=${API_TIMEOUT_MS}ms SERVER_ENABLED=${SERVER_ENABLED} `
  );
}

/* ------------------------------------------------------------------ */
/* Utilities: timeout + upstream AbortController compose               */
/* ------------------------------------------------------------------ */
function serverAvailable() {
  return SERVER_ENABLED && typeof API_BASE === "string" && API_BASE.length > 0;
}

// Hem AbortController hem AbortSignal kabul et
function asAbortSignal(maybe) {
  if (!maybe) return null;
  if (typeof maybe === "object" && typeof maybe.abort === "function" && maybe.signal) {
    return maybe.signal; // AbortController
  }
  if (
    typeof maybe === "object" &&
    typeof maybe.aborted === "boolean" &&
    typeof maybe.addEventListener === "function"
  ) {
    return maybe; // AbortSignal
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

// 🔧 Güvenli fetch: RN Android + Abort bug’ları için bazı isteklerde sinyali kapat
async function fetchJson(
  urlStr,
  { method = "GET", headers, body, signal, timeoutMs } = {}
) {
  const url = String(urlStr);
  const isAndroid = Platform.OS === "android";

  // GÜNCEL: /api/poi/match de no-signal kapsamına alındı
  const isPoiGoogle = url.includes("/api/poi/google/");
  const isPoiMatch = url.includes("/api/poi/match");
  const forceNoSignal = isAndroid && (isPoiGoogle || isPoiMatch);

  const T = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : API_TIMEOUT_MS;
  const { signal: finalSignal, cleanup } = forceNoSignal
    ? { signal: undefined, cleanup: () => {} }
    : composeAbortController(signal, T);

  const h = { Accept: "application/json", ...(headers || {}) };
  // RN Android + proxy: gzip bazı ortamlarda body'nin resolve olmamasına yol açabiliyor
  if (isPoiGoogle || isPoiMatch) h["Accept-Encoding"] = "identity";
  const baseOpts = { method, headers: h, body };

  try {
    if (forceNoSignal) {
      // Android RN abort bug’u için: signal yok ama yine de HARD TIMEOUT uygula
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
        // sinyalsiz – RN abort bug’ını by-pass (ikinci denemede de hard-timeout uygula)
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

/* -------------------------------- helpers ------------------------------- */
function toArray(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.results)) return json.results;
  if (json && Array.isArray(json.predictions)) return json.predictions;
  return [];
}

const isNetFail = (e) => String(e?.message || "").includes("Network request failed");
const tryFetch = (base, builder, { signal, timeoutMs }) =>
  fetchJson(builder(base), { signal, timeoutMs });

/* ------------------------------------------------------------------ */
/* Public helpers                                                      */
/* ------------------------------------------------------------------ */
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

/* ================== AUTOCOMPLETE (server proxy + multi-failover) ================== */
export async function poiAutocomplete(
  q,
  { lat, lon, city, limit = 8, sessionToken, timeoutMs, signal } = {}
) {
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
      const res = await fetchJson(url, { signal, timeoutMs: T });
      if (!res.ok)
        throw new Error(
          `poiAutocomplete_failed_${res.status}_${await res.text().catch(() => "")}`
        );
      const json = await res.json();
      const arr = toArray(json);
      if (__DEV__) {
        try {
          console.log(
            "[poiAutocomplete] status=",
            res.status,
            "X-Cache=",
            res.headers.get("X-Cache"),
            "X-Google-Count=",
            res.headers.get("X-Google-Count")
          );
        } catch {}
      }
      return arr;
    } catch (e1) {
      // Genişletilmiş failover: localhost <-> 10.0.2.2 <-> PROD, sonra direct Google
      if (isNetFail(e1)) {
        // localhost → 10.0.2.2
        if (API_BASE.includes("localhost")) {
          try {
            const resL = await tryFetch("http://10.0.2.2:5000", build, { signal, timeoutMs: T });
            if (!resL.ok) throw new Error(`poiAutocomplete_failed_${resL.status}`);
            if (__DEV__) console.warn("[poiAutocomplete] FAILOVER → 10.0.2.2");
            return toArray(await resL.json());
          } catch {}
        }
        // 10.0.2.2 → localhost
        if (API_BASE.includes("10.0.2.2")) {
          try {
            const resLoc = await tryFetch("http://localhost:5000", build, {
              signal,
              timeoutMs: T,
            });
            if (!resLoc.ok) throw new Error(`poiAutocomplete_failed_${resLoc.status}`);
            if (__DEV__) console.warn("[poiAutocomplete] FAILOVER → localhost");
            return toArray(await resLoc.json());
          } catch {}
        }
        // Dev hostlar → PROD
        if (API_BASE.includes("localhost") || API_BASE.includes("10.0.2.2")) {
          try {
            const resP = await tryFetch(PROD_BASE, build, { signal, timeoutMs: T });
            if (!resP.ok) throw new Error(`poiAutocomplete_failed_${resP.status}`);
            if (__DEV__) console.warn("[poiAutocomplete] FAILOVER → PROD");
            return toArray(await resP.json());
          } catch {}
        }
      }

      // (Opsiyonel) Doğrudan Google
      if (GOOGLE_WEB_KEY) {
        try {
          const p = new URLSearchParams({
            input: String(q || ""),
            key: GOOGLE_WEB_KEY,
            language: "tr",
            region: "TR",
            types: "establishment",
          });
          if (lat != null && lon != null) {
            p.set("location", `${lat},${lon}`);
            p.set("radius", "30000");
          }
          if (sessionToken) p.set("sessiontoken", String(sessionToken));
          const gUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${p}`;
          if (__DEV__) console.warn("[poiAutocomplete] DIRECT GOOGLE →", gUrl);
          const rG = await fetchJson(gUrl, { timeoutMs: T });
          const jG = await rG.json();
          const preds = Array.isArray(jG?.predictions) ? jG.predictions : [];
          return preds.map((p) => ({
            source: "google",
            name: p?.structured_formatting?.main_text || p?.description || "",
            place_id: p?.place_id,
            address: p?.description || "",
            city: city || "",
          }));
        } catch (e3) {
          if (__DEV__)
            console.warn("[poiAutocomplete] direct-google failed:", e3?.message || e3);
        }
      }

      throw e1;
    }
  }

  // serverAvailable değilse, opsiyonel direct Google:
  if (GOOGLE_WEB_KEY) {
    const p = new URLSearchParams({
      input: String(q || ""),
      key: GOOGLE_WEB_KEY,
      language: "tr",
      region: "TR",
      types: "establishment",
    });
    if (lat != null && lon != null) {
      p.set("location", `${lat},${lon}`);
      p.set("radius", "30000");
    }
    if (sessionToken) p.set("sessiontoken", String(sessionToken));
    const gUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${p}`;
    const rG = await fetchJson(gUrl, { timeoutMs: T });
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

/* ========== SEARCH (TextSearch/Nearby) — proxy + geniş failover ========== */
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
      const res = await fetchJson(url, { signal, timeoutMs: T1 });
      if (!res.ok) throw new Error(`poiSearch_failed_${res.status}`);
      const json = await res.json();
      if (__DEV__) {
        try {
          console.log(
            "[poiSearch] status=",
            res.status,
            "X-Cache=",
            res.headers.get("X-Cache"),
            "X-Google-Count=",
            res.headers.get("X-Google-Count")
          );
        } catch {}
      }
      return toArray(json);
    } catch (e1) {
      if (isNetFail(e1)) {
        // localhost → 10.0.2.2
        if (API_BASE.includes("localhost")) {
          try {
            const resL = await tryFetch("http://10.0.2.2:5000", build, { signal, timeoutMs: T1 });
            if (!resL.ok) throw new Error(`poiSearch_failed_${resL.status}`);
            if (__DEV__) console.warn("[poiSearch] FAILOVER → 10.0.2.2");
            return toArray(await resL.json());
          } catch {}
        }
        // 10.0.2.2 → localhost
        if (API_BASE.includes("10.0.2.2")) {
          try {
            const resLoc = await tryFetch("http://localhost:5000", build, {
              signal,
              timeoutMs: T1,
            });
            if (!resLoc.ok) throw new Error(`poiSearch_failed_${resLoc.status}`);
            if (__DEV__) console.warn("[poiSearch] FAILOVER → localhost");
            return toArray(await resLoc.json());
          } catch {}
        }
        // Dev hostlar → PROD
        if (API_BASE.includes("localhost") || API_BASE.includes("10.0.2.2")) {
          try {
            const resP = await tryFetch(PROD_BASE, build, { signal, timeoutMs: T1 });
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

  // GÜNCEL: fetchJson kullanıyoruz → RN Abort bug bypass + tek noktadan timeout
  const url = `${API_BASE}/api/poi/match`;
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
  return res.json(); // { results: [...] }
}
