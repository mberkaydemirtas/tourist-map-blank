// app/lib/api.js
import { Platform, NativeModules } from "react-native";
import Constants from "expo-constants";
import 'react-native-get-random-values';

/**
 * ENV:
 * - EXPO_PUBLIC_API_BASE            : http://192.168.1.111:5000 (tam URL)
 * - EXPO_PUBLIC_SERVER_ENABLED      : "true" | "false"
 * - EXPO_PUBLIC_API_TIMEOUT_MS      : sayı (ms)
 * - EXPO_PUBLIC_GOOGLE_MAPS_API_KEY : (opsiyonel) client-side fallback için
 * - EXPO_PUBLIC_USE_ADB_REVERSE     : "true" | "false" (opsiyonel) → 127.0.0.1:5000
 */

const PROD_BASE = "https://tourist-map-blank-12.onrender.com";

// Android emulator için
const ANDROID_EMULATOR_BASE = "http://10.0.2.2:5000";
// iOS simulator için
const IOS_SIMULATOR_BASE = "http://localhost:5000";
// ADB reverse (adb reverse tcp:5000 tcp:5000) kullanıyorsan
const REVERSE_BASE = "http://127.0.0.1:5000";

// =========================
// ✅ Device ID (persisted)
// =========================
const DEVICE_ID_STORAGE_KEY = "@touristmap_device_id_v1";

// AsyncStorage dinamik import (paket yoksa app patlamasın)
async function getAsyncStorage() {
  try {
    const mod = await import("@react-native-async-storage/async-storage");
    return mod?.default || mod;
  } catch {
    return null;
  }
}

function genDeviceId() {
  // crypto varsa UUID
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return `dev_${globalThis.crypto.randomUUID()}`;
    }
  } catch {}

  const rnd = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `dev_${ts}_${rnd}`;
}

let _cachedDeviceId = null;
let _deviceIdPromise = null;

export async function getDeviceId() {
  if (_cachedDeviceId) return _cachedDeviceId;
  if (_deviceIdPromise) return _deviceIdPromise;

  _deviceIdPromise = (async () => {
    const AS = await getAsyncStorage();
    if (!AS) {
      // AsyncStorage yoksa, en azından runtime id üret (persist yok)
      const tmp = genDeviceId();
      _cachedDeviceId = tmp;
      return tmp;
    }

    try {
      const existing = await AS.getItem(DEVICE_ID_STORAGE_KEY);
      if (existing && String(existing).trim().length > 4) {
        _cachedDeviceId = String(existing);
        return _cachedDeviceId;
      }
    } catch {}

    const created = genDeviceId();
    try {
      await AS.setItem(DEVICE_ID_STORAGE_KEY, created);
    } catch {}
    _cachedDeviceId = created;
    return created;
  })();

  return _deviceIdPromise;
}

// Metro host’u scriptURL’den çek (örn. 192.168.1.111)
function getMetroHostFromScriptURL() {
  try {
    const url = NativeModules?.SourceCode?.scriptURL || "";
    const m = url.match(/\/\/([^:]+):\d+\//);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const METRO_HOST = getMetroHostFromScriptURL();

// Not: Constants.isDevice bazen custom dev client / bazı ortamlarda yanlış gelebiliyor.
// Biz base seçimini IS_DEVICE'a bağlamıyoruz; METRO_HOST + ENV ile deterministik yapıyoruz.
const IS_DEVICE = !!Constants?.isDevice;

const ENV_API_BASE = (process.env?.EXPO_PUBLIC_API_BASE || "").trim();
const ENV_SERVER_ENABLED_RAW = (process.env?.EXPO_PUBLIC_SERVER_ENABLED || "")
  .trim()
  .toLowerCase();
const ENV_TIMEOUT_RAW = (process.env?.EXPO_PUBLIC_API_TIMEOUT_MS || "").trim();
const GOOGLE_WEB_KEY = (process.env?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim();
const ENV_USE_REVERSE_RAW = (process.env?.EXPO_PUBLIC_USE_ADB_REVERSE || "")
  .trim()
  .toLowerCase();

const USE_ADB_REVERSE = ENV_USE_REVERSE_RAW === "true";

// METRO_HOST varsa (ve localhost değilse) genelde PC’nin LAN IP’sidir.
function isProbablyLanHost(host) {
  if (!host) return false;
  const h = String(host).toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return false;
  // 192.168.x.x / 10.x.x.x / 172.16-31.x.x LAN olabilir
  return true;
}

function computeDevBase() {
  // 1) ENV her zaman kazansın
  if (ENV_API_BASE) return { base: ENV_API_BASE, why: "ENV_API_BASE" };

  // 2) ADB reverse istenmişse (USB ADB ya da destekli wireless)
  if (USE_ADB_REVERSE) return { base: REVERSE_BASE, why: "ADB_REVERSE" };

  // 3) Metro host üzerinden PC IP’yi yakala
  if (isProbablyLanHost(METRO_HOST)) {
    return { base: `http://${METRO_HOST}:5000`, why: "METRO_HOST" };
  }

  // 4) Son fallback: emulator/simulator
  if (Platform.OS === "android")
    return { base: ANDROID_EMULATOR_BASE, why: "ANDROID_EMULATOR_FALLBACK" };
  return { base: IOS_SIMULATOR_BASE, why: "IOS_SIMULATOR_FALLBACK" };
}

function computeBase() {
  if (__DEV__) return computeDevBase();
  // prod
  return { base: PROD_BASE, why: "PROD_BASE" };
}

// ✅ Tek doğru kaynak: burada hesaplanır
const RESOLVED = computeBase();

/**
 * API_BASE:
 * - ENV varsa → onu kullanır
 * - Dev’de ENV yoksa → METRO_HOST'tan üretir (senin durumda 192.168.1.111)
 * - Hiçbiri yoksa → emulator/simulator fallback
 */
export const API_BASE = RESOLVED.base;

// Server enabled mantığı:
// - ENV "false" ise kapat
// - Aksi halde base varsa açık say
export const SERVER_ENABLED =
  ENV_SERVER_ENABLED_RAW === "false"
    ? false
    : Boolean(API_BASE && String(API_BASE).length);

const _tParsed = Number(ENV_TIMEOUT_RAW);
export const API_TIMEOUT_MS =
  Number.isFinite(_tParsed) && _tParsed > 0 ? _tParsed : 15000;

if (__DEV__) {
  console.log(
    `[API] BASE=${API_BASE} (why=${RESOLVED.why}) TIMEOUT=${API_TIMEOUT_MS}ms SERVER_ENABLED=${SERVER_ENABLED}`
  );
  console.log("[API] ENV_API_BASE =", ENV_API_BASE || "(none)");
  console.log("[API] USE_ADB_REVERSE =", USE_ADB_REVERSE);
  console.log("[API] IS_DEVICE =", IS_DEVICE, "METRO_HOST =", METRO_HOST || "(none)");
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

/**
 * fetchJson:
 * - Suggest endpoint için signal kullanılabilir → request birikmesi azalır.
 * - Sadece gerçekten problemli endpoint’lerde “no signal + manual timeout” moduna geçer.
 * - cleanup tek yerde çalışır.
 */
async function fetchJson(
  urlStr,
  { method = "GET", headers, body, signal, timeoutMs } = {}
) {
  const url = String(urlStr);
  const isAndroid = Platform.OS === "android";

  const isPoiGoogle = url.includes("/api/poi/google/") || url.includes("/api/places/");
  const isPoiMatch = url.includes("/api/poi/match");
  const isSuggest = url.includes("/api/poi/suggest");

  // ✅ suggest endpoint'i için asla forceNoSignal yapma
  const forceNoSignal = isAndroid && !isSuggest && (isPoiGoogle || isPoiMatch);

  const T = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : API_TIMEOUT_MS;

  // signal/cleanup set
  const ctrl = forceNoSignal ? null : composeAbortController(signal, T);
  const finalSignal = ctrl?.signal;

  const h = { Accept: "application/json", ...(headers || {}) };
  if (isPoiGoogle || isPoiMatch) h["Accept-Encoding"] = "identity";
  const baseOpts = { method, headers: h, body };

  const cleanupOnce = () => {
    try {
      ctrl?.cleanup?.();
    } catch {}
  };

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
      msg.includes("invalid value for signal");

    const looksLikeAbortOrRnBug =
      e?.name === "AbortError" || msg.includes("Network request failed");

    const canRetryWithoutSignal = !forceNoSignal && !!finalSignal;

    if ((looksLikeSignalUnsupported || looksLikeAbortOrRnBug) && canRetryWithoutSignal) {
      try {
        if (__DEV__) console.warn("[fetchJson] re-try without signal due to:", msg || "(unknown)");
        const p2 = fetch(url, baseOpts);
        const t2 = new Promise((_, rej) =>
          setTimeout(() => rej(new Error(`tmout_retry_no_signal_${T}`)), T)
        );
        return await Promise.race([p2, t2]);
      } finally {
        cleanupOnce();
      }
    }

    throw e;
  } finally {
    cleanupOnce();
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

/* ========================= SUGGEST-FIRST AYARLAR ========================= */

const MIN_CHARS_SUGGEST = 2;
const MIN_PREFIX_FOR_GOOGLE = 3;
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

const _prefixSatisfy = new Map();

function markPrefixSatisfied(q, city) {
  const norm = trFold(q);
  const c = normCity(city);
  const key = `${c}|${norm}`;
  _prefixSatisfy.set(key, Date.now() + SUGGEST_PREFIX_TTL_MS);
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
    if (!cats.size) return true;
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

  const satisfied = filteredCount >= SUGGEST_MIN_TO_SKIP_GOOGLE;

  if (satisfied) {
    markPrefixSatisfied(q, city);
    if (__DEV__) {
      console.log(
        `[suggestGate] satisfied raw=${rawCount} filtered=${filteredCount} min=${SUGGEST_MIN_TO_SKIP_GOOGLE} → SKIP google`
      );
    }
    return { satisfied: true, results: filtered };
  }

  if (__DEV__) {
    console.log(
      `[suggestGate] not satisfied raw=${rawCount} filtered=${filteredCount} min=${SUGGEST_MIN_TO_SKIP_GOOGLE} → MAY fallback to google`
    );
  }

  return { satisfied: false, results: filtered };
}

const mapSuggest = (results, { city }) =>
  (results || []).map((s) => ({
    source: "suggest",
    name: s.name,
    place_id: s.place_id,
    address: s.address || "",
    city: s.city || city || "",
    lat: s.lat,
    lon: s.lon,
    rating: s.rating,
    user_ratings_total: s.user_ratings_total,
  }));

export async function poiAutocomplete(
  q,
  { lat, lon, city, limit = 8, sessionToken, timeoutMs, signal, category } = {}
) {
  const qTrim = String(q || "").trim();
  if (qTrim.length < MIN_CHARS_SUGGEST) return [];

  const gate1 = await suggestGateFirst(qTrim, {
    city,
    category,
    limit,
    timeoutMs,
    signal,
  });

  if (gate1.satisfied) return mapSuggest(gate1.results, { city });

  if (qTrim.length < MIN_PREFIX_FOR_GOOGLE) return mapSuggest(gate1.results, { city });

  const T = Number.isFinite(Number(timeoutMs))
    ? Number(timeoutMs)
    : Math.max(API_TIMEOUT_MS, 9000);

  const makeUrl = (base, path) => {
    const u = new URL(`${base}${path}`);
    u.searchParams.set("q", String(qTrim));
    if (lat != null) u.searchParams.set("lat", String(lat));
    if (lon != null) u.searchParams.set("lon", String(lon));
    if (city) u.searchParams.set("city", String(city));
    u.searchParams.set("limit", String(limit));
    if (sessionToken) u.searchParams.set("sessiontoken", String(sessionToken));
    if (category) u.searchParams.set("category", String(category));
    return String(u);
  };

  const candidates = [
    makeUrl(API_BASE, "/api/poi/google/autocomplete"),
    makeUrl(API_BASE, "/api/places/autocomplete"),
  ];

  for (const url of candidates) {
    try {
      if (__DEV__) console.log("[poiAutocomplete] url=", url);
      const res = await fetchJsonDedup(url, { signal, timeoutMs: T }, T);
      if (res.ok) {
        const json = await res.json();
        return toArray(json);
      }
    } catch {}
  }
  return [];
}

/* ========== SEARCH — sadece submit olduğunda çağrılmalı ========== */
export async function poiSearch(
  q,
  { lat, lon, category, city, timeoutMs, signal, isSubmit = true } = {}
) {
  const qTrim = String(q || "").trim();
  if (qTrim.length < MIN_CHARS_SUGGEST) return [];

  const T1 = Number.isFinite(Number(timeoutMs))
    ? Number(timeoutMs)
    : Math.max(API_TIMEOUT_MS, 10000);

  const makeUrl = (base, path) => {
    const u = new URL(`${base}${path}`);
    u.searchParams.set("q", String(qTrim));
    if (lat != null) u.searchParams.set("lat", String(lat));
    if (lon != null) u.searchParams.set("lon", String(lon));
    if (city) u.searchParams.set("city", String(city));
    if (category) u.searchParams.set("category", String(category));
    if (isSubmit) u.searchParams.set("submit", "1");
    return String(u);
  };

  const candidates = [
    makeUrl(API_BASE, "/api/poi/google/search"),
    makeUrl(API_BASE, "/api/places/search"),
    makeUrl(API_BASE, "/api/places/textsearch"),
  ];

  if (serverAvailable()) {
    for (const url of candidates) {
      try {
        if (__DEV__) console.log("[poiSearch] url=", url);
        const res = await fetchJsonDedup(
          url,
          {
            signal,
            timeoutMs: T1,
            headers: isSubmit ? { "x-submit-search": "1" } : undefined,
          },
          T1
        );
        if (res.status === 204) {
          if (__DEV__) console.warn("[poiSearch] BLOCKED by server (no submit)");
          return [];
        }
        if (res.ok) {
          const json = await res.json();
          return toArray(json);
        }
      } catch {}
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

  // ✅ deviceId verilmediyse otomatik üret + persist et
  let did = deviceId;
  try {
    if (!did) did = await getDeviceId();
  } catch {}

  const h = {
    "Content-Type": "application/json",
    ...(did ? { "x-device-id": did } : null),
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
export async function poiMatch(payloadOrItems, city) {
  if (!serverAvailable()) return { results: [] };

  const itemsArr = Array.isArray(payloadOrItems)
    ? payloadOrItems
    : (Array.isArray(payloadOrItems?.items) ? payloadOrItems.items : []);

  const url = `${API_BASE}/api/poi/match`;

  try {
    const res = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      timeoutMs: API_TIMEOUT_MS,
      body: JSON.stringify({
        items: (itemsArr || []).map((x) => ({
          item_id: x.item_id ?? x.osm_id ?? null,
          osm_id: x.osm_id ?? x.item_id ?? null,
          name: x.name,
          lat: x.lat,
          lon: x.lon,
          city: city || x.city || "Ankara",
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
  { city, category, lat, lon, sessionToken, isSubmit = false, limit = 12, timeoutMs, signal } = {}
) {
  const qTrim = String(q || "").trim();
  if (qTrim.length < MIN_CHARS_SUGGEST) return [];

  const guardKey = `${city || ""}|${qTrim}`;
  const now = Date.now();
  const last = _strokeGuard.get(guardKey) || 0;
  if (now - last < 250) return [];
  _strokeGuard.set(guardKey, now);

  if (!isSubmit) {
    return await poiAutocomplete(qTrim, {
      city,
      category,
      lat,
      lon,
      sessionToken,
      limit: Math.min(8, limit),
      timeoutMs,
      signal,
    });
  }

  return await poiSearch(qTrim, {
    city,
    category,
    lat,
    lon,
    timeoutMs,
    signal,
    isSubmit: true,
  });
}

/* ====================================================================== */
/* ✅ TRIPS API                                                           */
/* ====================================================================== */

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function createTrip(trip, { timeoutMs } = {}) {
  if (!serverAvailable()) throw new Error("server_disabled");

  const res = await apiFetch(`/api/trips`, {
    method: "POST",
    body: trip,
    timeoutMs: timeoutMs ?? API_TIMEOUT_MS,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`createTrip_POST_failed_${res.status}_${txt || ""}`);
  }
  return res.json().catch(() => ({}));
}

export async function updateTrip(tripId, patch, { timeoutMs } = {}) {
  if (!serverAvailable()) throw new Error("server_disabled");
  if (!tripId) throw new Error("missing_tripId");

  const id = encodeURIComponent(String(tripId));
  const path = `/api/trips/${id}`;

  try {
    const res = await apiFetch(path, {
      method: "PATCH",
      body: patch,
      timeoutMs: timeoutMs ?? API_TIMEOUT_MS,
    });
    if (res.ok) return res.json().catch(() => ({}));

    const txt = await res.text().catch(() => "");
    const j = safeJsonParse(txt);
    const code = res.status;
    throw Object.assign(
      new Error(`updateTrip_PATCH_failed_${code}_${j?.error || txt || ""}`),
      { status: code, raw: txt, json: j }
    );
  } catch (e) {
    const res2 = await apiFetch(path, {
      method: "PUT",
      body: patch,
      timeoutMs: timeoutMs ?? API_TIMEOUT_MS,
    });

    if (!res2.ok) {
      const txt2 = await res2.text().catch(() => "");
      throw Object.assign(
        new Error(`updateTrip_PUT_failed_${res2.status}_${txt2 || ""}`),
        { status: res2.status, raw: txt2 }
      );
    }
    return res2.json().catch(() => ({}));
  }
}

export async function upsertTrip(tripId, payload, { timeoutMs } = {}) {
  if (!tripId) throw new Error("missing_tripId");

  try {
    return await updateTrip(tripId, payload, { timeoutMs });
  } catch (e) {
    const status = e?.status;
    const msg = String(e?.message || "");

    const is404 =
      status === 404 ||
      msg.includes("_404_") ||
      msg.includes("failed_404") ||
      msg.includes("not_found");

    if (is404) {
      return await createTrip({ id: String(tripId), ...payload }, { timeoutMs });
    }

    throw e;
  }
}

export async function updateTripSelectedPlaces(tripId, selectedPlaces, opts = {}) {
  const patch = { selectedPlaces: Array.isArray(selectedPlaces) ? selectedPlaces : [] };
  return upsertTrip(tripId, patch, opts);
}
