// app/screens/TripPlacesScreen.js
import React, { useEffect, useState, useMemo } from "react";
import { Platform } from "react-native";
import TripPlaceSelection from "../components/TripPlaceSelection";
import { resolvePlacesBatch } from '../services/placeResolver';

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
const PROD_BASE = "https://tourist-map-blank-12.onrender.com"; // prod domain hazır değilse şimdilik aynı kalsın

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
      const resolved = await resolvePlacesBatch({
        items: selected,
        city: "Ankara",
        API_BASE,
      });
      console.log("Resolved places:", resolved);
      // TODO: burada wizard/route state’ine yazın:
      // setSelectedPlaces(resolved)
      // veya navigation ile wizard'a geri dönün.
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
