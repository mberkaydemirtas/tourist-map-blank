// app/lib/api.js
import { Platform } from "react-native";

/**
 * ENV:
 * - EXPO_PUBLIC_API_BASE         : https://… (tam URL)
 * - EXPO_PUBLIC_SERVER_ENABLED   : "true" | "false"
 * - EXPO_PUBLIC_API_TIMEOUT_MS   : sayı (ms)
 */

const PROD_BASE = "https://tourist-map-blank-10.onrender.com";
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

export const API_BASE =
  ENV_API_BASE ||
  (__DEV__ ? (isEmulatorOrSim ? LOCAL_BASE : PROD_BASE) : PROD_BASE);

export const SERVER_ENABLED =
  ENV_SERVER_ENABLED_RAW === "false"
    ? false
    : Boolean(API_BASE && API_BASE.length);

export const API_TIMEOUT_MS = Number.isFinite(Number(ENV_TIMEOUT_RAW))
  ? Number(ENV_TIMEOUT_RAW)
  : 5000;

function serverAvailable() {
  return SERVER_ENABLED && typeof API_BASE === "string" && API_BASE.length > 0;
}

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

  const ctrl =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer = null;
  if (ctrl) {
    timer = setTimeout(
      () => ctrl.abort(),
      Number(timeoutMs ?? API_TIMEOUT_MS)
    );
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl?.signal,
    });
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ---------------- POI yardımcıları (server) ---------------- */

export async function poiSearch(q, { lat, lon, category, city }) {
  if (!serverAvailable()) return []; // offline no-op
  const url =
    `${API_BASE}/api/poi/google/search` +
    `?q=${encodeURIComponent(q || "")}` +
    `&lat=${lat ?? ""}&lon=${lon ?? ""}` +
    `&city=${encodeURIComponent(city || "")}` +
    `&category=${encodeURIComponent(category || "")}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("poiSearch_failed");
    return res.json(); // [{source:'google', name, lat, lon, place_id}, ...]
  } finally {
    clearTimeout(t);
  }
}

export async function poiMatch(items, city) {
  if (!serverAvailable()) return { results: [] };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/poi/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
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
    if (!res.ok) throw new Error("poiMatch_failed");
    return res.json(); // { results: [...] }
  } finally {
    clearTimeout(t);
  }
}
