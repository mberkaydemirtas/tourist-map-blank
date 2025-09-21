import { Platform } from "react-native";

/**
 * ÖNEMLİ:
 * - Gerçek cihazda test ederken "localhost" çalışmaz.
 * - Aşağıdaki sıra:
 *   1) EXPO_PUBLIC_API_BASE (varsa her zaman bunu kullan)
 *   2) PROD_BASE (Render alan adın)
 *   3) SADECE emülatör/sim'de LOCAL_BASE
 *
 * İpucu: .env ya da app.json (expo) ile:
 *   EXPO_PUBLIC_API_BASE=https://tourist-map-blank-10.onrender.com
 */
const PROD_BASE = "https://tourist-map-blank-10.onrender.com";
const LOCAL_BASE = Platform.OS === "android" ? "http://10.0.2.2:5000" : "http://localhost:5000";

let isEmulatorOrSim = false;
try {
  // expo-constants varsa kullan; yoksa false kalır (gerçek cihaz varsayılır)
  const Constants = require("expo-constants").default;
  isEmulatorOrSim = !Constants.isDevice;
} catch { /* noop */ }

export const API_BASE =
  (process.env?.EXPO_PUBLIC_API_BASE && String(process.env.EXPO_PUBLIC_API_BASE).trim()) ||
  // Geliştirme modunda: emülatör/sim'de LOCAL, gerçek cihazda PROD
  (__DEV__ ? (isEmulatorOrSim ? LOCAL_BASE : PROD_BASE) : PROD_BASE);

// Ortak fetch helper (gerekirse x-device-id ekleyebilirsin)
export async function apiFetch(path, { method = "GET", headers = {}, body } = {}) {
  const h = {
    "Content-Type": "application/json",
    ...headers,
  };
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

// ---- POI yardımcıları ----

export async function poiSearch(q, { lat, lon, category, city }) {
  const url = `${API_BASE}/api/poi/google/search` +
    `?q=${encodeURIComponent(q)}` +
    `&lat=${lat}&lon=${lon}` +
    `&city=${encodeURIComponent(city || "")}` +
    `&category=${encodeURIComponent(category || "")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("poiSearch_failed");
  return res.json(); // [{source:'google', name, lat, lon, place_id}, ...]
}

export async function poiMatch(items, city) {
  const res = await fetch(`${API_BASE}/api/poi/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: items.map(x => ({
        osm_id: x.osm_id,
        name: x.name,
        lat: x.lat,
        lon: x.lon,
        city: city || "Ankara",
      }))
    })
  });
  if (!res.ok) throw new Error("poiMatch_failed");
  return res.json(); // { results: [...] }
}
