// app/screens/TripPlacesScreen.js
import React, { useEffect, useState, useMemo } from "react";
import { Platform } from "react-native";
import TripPlaceSelection from "../components/TripPlaceSelection";

// ---------- API BASE (otomatik seç) ----------
/**
 * LOCAL GELİŞTİRME:
 * - iOS Simülatör: http://localhost:5000
 * - Android Emülatör (AVD): http://10.0.2.2:5000
 * - Gerçek cihaz: Makinenin LAN IP’si (örn. http://192.168.1.100:5000)
 *
 * PROD:
 * - Aşağıdaki PROD_BASE'e kendi domain'ini koy (örn. https://api.senin-domainin.com)
 */
const PROD_BASE = "https://tourist-map-blank-10.onrender.com"; // prod domain hazır değilse şimdilik aynı kalsın

const LOCAL_BASE = (() => {
  if (Platform.OS === "android") return "http://10.0.2.2:5000";
  return "http://localhost:5000";
})();

// Geliştirme mi prod mu?
const API_BASE = __DEV__ ? LOCAL_BASE : PROD_BASE;

// ---------- Ekran ----------
export default function TripPlacesScreen() {
  const [initialData, setInitialData] = useState([]);

  // OSM/DB verini burada yükleyip initialData’ya ver (opsiyonel)
  useEffect(() => {
    // Örn: setInitialData(osmArrayFromDB);
  }, []);

  // Google arama: önce local verin bakılıyor (TripPlaceSelection içinde), yoksa server
  const googleSearchFn = async (q, ctx) => {
    try {
      const qq = (q || "").trim();
      if (qq.length < 2) return [];
      const url =
        `${API_BASE}/api/poi/google/search` +
        `?q=${encodeURIComponent(qq)}` +
        `&lat=${ctx.lat}&lon=${ctx.lon}` +
        `&city=${encodeURIComponent(ctx.city || "")}` +
        `&category=${encodeURIComponent(ctx.category || "")}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`poiSearch_failed_${res.status}`);
      return await res.json(); // [{source:'google', name, lat, lon, place_id}, ...]
    } catch (err) {
      console.warn("googleSearchFn error:", err?.message || err);
      return [];
    }
  };

  // Seçimi onayla → OSM noktalarını lazy match ile place_id'ye bağla
  const onConfirm = async (selected) => {
    try {
      const osmOnly = selected.filter(x => x.source === "osm" && !x.place_id);
      let matches = [];
      if (osmOnly.length) {
        const res = await fetch(`${API_BASE}/api/poi/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: osmOnly.map(x => ({
              osm_id: x.osm_id,
              name: x.name,
              lat: x.lat,
              lon: x.lon,
              city: "Ankara",
            }))
          })
        });
        if (!res.ok) throw new Error(`poiMatch_failed_${res.status}`);
        const json = await res.json();
        matches = json.results || [];
      }

      const byKey = new Map(matches.map(m => [m.osm_id ?? `${m.name}@${m.lat},${m.lon}`, m]));
      const merged = selected.map(item => {
        if (item.source === "osm" && !item.place_id) {
          const k = item.osm_id ?? `${item.name}@${item.lat},${item.lon}`;
          const m = byKey.get(k);
          if (m?.matched && m.place_id) return { ...item, place_id: m.place_id };
        }
        return item;
      });

      console.log("Rota noktaları:", merged);
      // navigation.navigate("RouteScreen", { points: merged })
    } catch (err) {
      console.warn("onConfirm error:", err?.message || err);
    }
  };

  return (
    <TripPlaceSelection
      city="ankara"
      initialData={initialData}       // OSM/DB verin (boşsa bileşen kendi CSV seed'i ile çalışır)
      googleSearchFn={googleSearchFn} // navigation-server endpoint’ine bağlı
      onConfirm={onConfirm}
    />
  );
}
