// app/screens/TripPlacesScreen.js
import React, { useEffect, useState, useCallback } from "react";
import TripPlaceSelection from "../components/TripPlaceSelection";
import { resolvePlacesBatch } from "../services/placeResolver";
import { API_BASE } from "../../app/lib/api";
import { Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";

// ---------- API BASE (otomatik seç) ----------
const PROD_BASE = "https://tourist-map-blank-12.onrender.com";

const LOCAL_BASE = (() => {
  if (Platform.OS === "android") return "http://192.168.1.108:5000";
  return "http://localhost:5000";
})();

// ---------- Ekran ----------
export default function TripPlacesScreen() {
  const navigation = useNavigation();

  const [initialData, setInitialData] = useState([]);

  useEffect(() => {
    // Örn: setInitialData(osmArrayFromDB);
  }, []);

  // Google arama: server üzerinden
  const googleSearchFn = useCallback(async (q, ctx) => {
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
  }, []);

  const onConfirm = useCallback(
    async (selected) => {
      try {
        const resolved = await resolvePlacesBatch({
          items: selected,
          city: "Ankara",
          API_BASE,
        });

        console.log("Resolved places:", resolved);

        // ✅ TripPlans’e gönderilecek payload (array)
        const places = (Array.isArray(resolved) ? resolved : [])
          .map((r, i) => {
            const lat = r?.coords?.latitude;
            const lng = r?.coords?.longitude;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

            return {
              key: r.key || r.place_id || r.id || `place_${Date.now()}_${i}`,
              description: r.description || r.name || "Seçilen yer",
              coords: { latitude: lat, longitude: lng },
              address: r.address || "",
              photoUrls: Array.isArray(r.photoUrls) ? r.photoUrls : [],
              insertIndex: null, // istersen buraya belirli index yazabilirsin
            };
          })
          .filter(Boolean);

        if (!places.length) {
          console.warn("[TripPlaces] resolved empty or coords missing");
          return;
        }

        // ✅ TripPlansScreen’e param taşı (merge:true önemli)
        navigation.navigate({
          name: "TripPlansScreen", // sende farklıysa ekran adını aynen yaz
          params: {
            __TP_INCOMING_PLACES: places,
          },
          merge: true,
        });
      } catch (err) {
        console.warn("onConfirm error:", err?.message || err);
      }
    },
    [navigation]
  );

  return (
    <TripPlaceSelection
      city="ankara"
      initialData={initialData}
      googleSearchFn={googleSearchFn}
      onConfirm={onConfirm}
    />
  );
}
