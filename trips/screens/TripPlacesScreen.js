// app/screens/TripPlacesScreen.js
import React, { useEffect, useState } from "react";
import TripPlaceSelection from "../components/TripPlaceSelection";
import { resolvePlacesBatch } from "../services/placeResolver";
import { API_BASE } from "../../app/lib/api";

<<<<<<< Updated upstream
=======
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
  if (Platform.OS === "android") return "http://192.168.1.108:5000";
  return "http://localhost:5000";
})();

// Geliştirme mi prod mu?
const API_BASE = __DEV__ ? LOCAL_BASE : PROD_BASE;

// ---------- Ekran ----------
>>>>>>> Stashed changes
export default function TripPlacesScreen() {
  const [initialData, setInitialData] = useState([]);

  useEffect(() => {
    // Örn: setInitialData(osmArrayFromDB);
  }, []);

  // Google arama: server üzerinden
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
      return await res.json();
    } catch (err) {
      console.warn("googleSearchFn error:", err?.message || err);
      return [];
    }
  };

  const onConfirm = async (selected) => {
    try {
      const resolved = await resolvePlacesBatch({
        items: selected,
        city: "Ankara",
        API_BASE,
      });
      console.log("Resolved places:", resolved);
      // TODO: wizard/route state’ine yaz
    } catch (err) {
      console.warn("onConfirm error:", err?.message || err);
    }
  };

  return (
    <TripPlaceSelection
      city="ankara"
      initialData={initialData}
      googleSearchFn={googleSearchFn}
      onConfirm={onConfirm}
    />
  );
}
